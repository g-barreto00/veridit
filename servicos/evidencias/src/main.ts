import 'reflect-metadata';
import { join } from 'node:path';
import {
  Controller,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request } from 'express';
import { MAX_TENTATIVAS, type CapturaConcluida } from '@veridit/contratos';
import {
  ConsumidorEventos,
  GuardaIdempotenciaPg,
  PublicadorRabbit,
  RelayOutbox,
  RepositorioRelayOutboxPg,
  SQL_TABELAS_MENSAGERIA,
  conectarBroker,
  registradorConsole as log,
} from '@veridit/mensageria';
import { criarPool, env, envNumero, migrar } from '@veridit/plataforma';
import { SelarEvidencia } from './aplicacao/selar-evidencia';
import { VerificarEvidencia } from './aplicacao/verificar-evidencia';
import { FalhaDefinitiva } from './dominio/erros';
import { ArmazenamentoS3, AssinadorKms, VerificadorOrigemHmac, criarKms, criarS3 } from './infra/adaptadores';
import { CarimboRfc3161 } from './infra/carimbo-rfc3161';
import {
  RegistradorEventosOutbox,
  RegistroCustodiaPg,
  RelogioSistema,
  RepositorioEvidenciasPg,
  comoTransacao,
} from './infra/repositorios-pg';

const CASOS = Symbol('CASOS');

/** Exposto pelo gateway em /api/evidencias/* (cada usuário só vê as próprias evidências). */
@Controller('evidencias')
class EvidenciasControlador {
  constructor(@Inject(CASOS) private readonly casos: { verificar: VerificarEvidencia }) {}

  @Get(':registroId')
  async verificar(@Req() req: Request, @Param('registroId') registroId: string) {
    const usuario = req.header('x-usuario-id');
    if (!usuario) throw new UnauthorizedException('Não autenticado');
    const r = await this.casos.verificar.executar(usuario, registroId);
    if (!r) throw new NotFoundException('Evidência não encontrada');
    return r;
  }
}

@Controller()
class SaudeControlador {
  @Get('saude')
  saude() {
    return { status: 'ok' };
  }
}

async function iniciar() {
  const pool = criarPool(env('DATABASE_URL'));
  const aplicadas = await migrar(pool, join(__dirname, '..', 'sql'), [SQL_TABELAS_MENSAGERIA]);
  if (aplicadas.length) log.info('migrações aplicadas', { aplicadas });

  const regiao = env('AWS_REGIAO', 'us-east-1');
  const armazenamento = new ArmazenamentoS3(
    criarS3(env('S3_ENDPOINT'), regiao),
    env('BUCKET_TEMPORARIO'),
    env('BUCKET_EVIDENCIAS'),
  );
  const carimbo = new CarimboRfc3161(env('URL_CARIMBO_TEMPO'));
  const evidencias = new RepositorioEvidenciasPg(pool);
  const custodia = new RegistroCustodiaPg(pool);

  const selar = new SelarEvidencia(
    new VerificadorOrigemHmac(env('CHAVE_ORIGEM_CAPTURA')),
    armazenamento,
    new AssinadorKms(criarKms(env('KMS_ENDPOINT'), regiao), env('KMS_CHAVE', 'alias/veridit-selagem')),
    carimbo,
    evidencias,
    custodia,
    new RegistradorEventosOutbox(),
    new RelogioSistema(),
  );
  const verificar = new VerificarEvidencia(evidencias, armazenamento, carimbo);

  const broker = conectarBroker(env('AMQP_URL'));
  new RelayOutbox(new RepositorioRelayOutboxPg(pool), new PublicadorRabbit(broker), {
    aoErro: (e) => log.error('falha no relay do outbox', { erro: String(e) }),
  }).iniciar();

  await new ConsumidorEventos(broker, {
    fila: 'evidencias',
    guarda: new GuardaIdempotenciaPg(pool),
    prefetch: 2,
    // Indisponibilidade de KMS, armazenamento ou da autoridade de carimbo: até 5 tentativas
    // espaçadas (5 s, 10 s, 20 s, 40 s) antes de desistir.
    atrasoBaseMs: 5000,
    manipuladores: {
      CapturaConcluida: async (e: CapturaConcluida, { transacao, tentativa }) => {
        const tx = comoTransacao(transacao!);
        try {
          const r = await selar.executar(tx, e);
          log.info(r === 'selada' ? 'evidência selada' : 'evidência já estava selada', { registroId: e.dados.registroId });
        } catch (erro) {
          const definitiva = erro instanceof FalhaDefinitiva || tentativa >= MAX_TENTATIVAS;
          log.warn('falha na selagem', { registroId: e.dados.registroId, tentativa, definitiva, erro: String(erro) });
          if (!definitiva) throw erro; // nova tentativa com backoff
          // Falha definitiva: avisa a saga (o Registros estorna os créditos).
          await selar.registrarFalha(tx, e.dados.registroId, erro instanceof Error ? erro.message : String(erro));
        }
      },
    },
  }).iniciar();

  // Verificador da cadeia de custódia: qualquer alteração no histórico é detectada.
  setInterval(async () => {
    const r = await custodia.verificarCadeia().catch(() => undefined);
    if (r && !r.integra) log.error('CADEIA DE CUSTÓDIA ROMPIDA', r);
  }, 10 * 60_000);

  @Module({ controllers: [EvidenciasControlador, SaudeControlador], providers: [{ provide: CASOS, useValue: { verificar } }] })
  class EvidenciasModulo {}

  const app = await NestFactory.create(EvidenciasModulo, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  const porta = envNumero('PORTA', 3004);
  await app.listen(porta);
  log.info('evidências no ar', { porta });
}

iniciar().catch((e) => {
  console.error(e);
  process.exit(1);
});
