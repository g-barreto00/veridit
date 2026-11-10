import { hostname } from 'node:os';
import { FILA_CAPTURA_SOLICITADA, type CapturaSolicitada } from '@veridit/contratos';
import {
  ConsumidorEventos,
  GuardaSemEstado,
  PublicadorRabbit,
  conectarBroker,
  registradorConsole as log,
} from '@veridit/mensageria';
import { env, envNumero } from './config';
import { AtenderSolicitacao, SessoesAtivas } from './aplicacao/atender-solicitacao';
import { ColetorMetadados } from './aplicacao/coletor-metadados';
import { FabricaNavegadoresDocker, enderecoNaRede } from './infra/navegador-docker';
import { criarServidorSessoes } from './infra/servidor-sessoes';
import {
  ArmazenamentoS3,
  RegistroConexoesProxy,
  RelogioSntp,
  ResolvedorDnsSistema,
  criarClienteS3,
} from './infra/servicos-externos';

/**
 * Worker de captura (C12): sem estado e sem acesso a banco (ADR-0009). Atende uma sessão por
 * vez; para escalar, sobem-se mais réplicas.
 */
async function iniciar() {
  const workerId = hostname();
  const porta = envNumero('PORTA', 7000);
  const ip = await enderecoNaRede(env('REDE_INTERNA'), workerId);

  const fabrica = new FabricaNavegadoresDocker(
    {
      imagem: env('IMAGEM_NAVEGADOR'),
      redeCaptura: env('REDE_CAPTURA'),
      workerId,
      memoriaBytes: envNumero('NAVEGADOR_MEMORIA_MB', 1536) * 1024 * 1024,
      cpus: envNumero('NAVEGADOR_CPUS', 1),
    },
    log,
  );
  await fabrica.limparOrfaos();

  const sessoes = new SessoesAtivas();
  const servidor = criarServidorSessoes(sessoes, log);
  servidor.listen(porta);

  const broker = conectarBroker(env('AMQP_URL'));
  const publicador = new PublicadorRabbit(broker);
  const dns = new ResolvedorDnsSistema();
  const ntp = new RelogioSntp(env('NTP_SERVIDOR', 'a.ntp.br'));
  const proxySaida = env('PROXY_SAIDA');
  const registroConexoes = new RegistroConexoesProxy(proxySaida, env('TOKEN_CONSULTA_PROXY'));
  const atender = new AtenderSolicitacao(
    {
      workerId,
      proxySaida,
      chaveOrigem: env('CHAVE_ORIGEM_CAPTURA'),
      enderecoWorker: `http://${ip}:${porta}`,
      idadeMaximaPedidoMs: 5 * 60_000, // = prazo de AGUARDANDO_SESSAO no Registros
      ociosidadeMaximaMs: envNumero('OCIOSIDADE_MAXIMA_S', 180) * 1000,
    },
    fabrica,
    new ArmazenamentoS3(criarClienteS3(env('S3_ENDPOINT'), env('S3_REGIAO', 'us-east-1')), env('BUCKET_TEMPORARIO')),
    (ipNavegador) => new ColetorMetadados(dns, ntp, registroConexoes, ipNavegador),
    publicador,
    sessoes,
    log,
  );

  await new ConsumidorEventos(broker, {
    fila: FILA_CAPTURA_SOLICITADA,
    prefetch: 1,
    guarda: new GuardaSemEstado(),
    // Sessão não é reprocessável automaticamente: falhas viram CapturaFalhou, não retentativa.
    maxTentativas: 1,
    manipuladores: {
      CapturaSolicitada: (e: CapturaSolicitada, ctx) => atender.executar(e, ctx),
    },
  }).iniciar();

  log.info('worker de captura no ar', { workerId, endereco: `${ip}:${porta}` });

  const encerrar = async () => {
    for (const s of sessoes.todas()) await s.falhar('Worker de captura reiniciado');
    setTimeout(() => process.exit(0), 3000);
  };
  process.on('SIGTERM', () => void encerrar());
  process.on('SIGINT', () => void encerrar());
}

iniciar().catch((e) => {
  console.error(e);
  process.exit(1);
});
