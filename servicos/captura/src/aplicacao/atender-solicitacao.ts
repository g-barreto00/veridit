import { randomBytes, randomUUID } from 'node:crypto';
import type { CapturaSolicitada } from '@veridit/contratos';
import { criarEvento, type ContextoConsumo, type PublicadorEventos, type Registrador } from '@veridit/mensageria';
import type { ArmazenamentoTemporario, FabricaNavegadores } from '../portas';
import type { ColetorMetadados } from './coletor-metadados';
import { SessaoCaptura } from './sessao-captura';

export interface ConfigAtendimento {
  proxySaida: string;
  workerId: string;
  /** Endereço deste worker na rede interna, para o gateway encaminhar o WebSocket. */
  enderecoWorker: string;
  /** Pedidos mais antigos que isto já foram dados como falhos pelo Monitor de Prazos (Registros). */
  idadeMaximaPedidoMs: number;
  ociosidadeMaximaMs: number;
}

/** Sessões ativas neste worker (no máximo uma, prefetch = 1), consultadas pelo servidor WebSocket. */
export class SessoesAtivas {
  private readonly sessoes = new Map<string, SessaoCaptura>();
  adicionar(s: SessaoCaptura) {
    this.sessoes.set(s.dados.sessaoId, s);
  }
  remover(id: string) {
    this.sessoes.delete(id);
  }
  obter(id: string) {
    return this.sessoes.get(id);
  }
  todas() {
    return [...this.sessoes.values()];
  }
}

/**
 * Consumidor de Solicitações (C12): atende um CapturaSolicitada do início ao fim. A mensagem só
 * recebe ack quando a sessão termina, então o worker não pega outra enquanto está ocupado
 * (prefetch = 1, ADR-0009).
 */
export class AtenderSolicitacao {
  constructor(
    private readonly config: ConfigAtendimento,
    private readonly fabrica: FabricaNavegadores,
    private readonly armazenamento: ArmazenamentoTemporario,
    private readonly criarColetor: (ipNavegador: string) => ColetorMetadados,
    private readonly publicador: PublicadorEventos,
    private readonly sessoes: SessoesAtivas,
    private readonly log: Registrador,
  ) {}

  async executar(pedido: CapturaSolicitada, ctx: Pick<ContextoConsumo, 'reentregue'>): Promise<void> {
    const { registroId } = pedido.dados;
    const meta = { correlationId: registroId, origem: `captura:${this.config.workerId}` };
    const falhar = (motivo: string) =>
      this.publicador.publicar(criarEvento('CapturaFalhou', { registroId, motivo }, meta));

    // Reentrega = um worker caiu no meio desta sessão; o usuário perdeu a conexão com ela.
    if (ctx.reentregue) return falhar('A sessão de captura foi interrompida. Inicie um novo registro.');
    if (Date.now() - new Date(pedido.ocorridoEm).getTime() > this.config.idadeMaximaPedidoMs) {
      return falhar('Pedido de captura expirou antes de haver um navegador disponível');
    }

    const sessaoId = randomUUID();
    let navegador;
    try {
      navegador = await this.fabrica.criar(sessaoId);
    } catch (e) {
      this.log.error('falha ao criar navegador', { registroId, erro: String(e) });
      return falhar('Não foi possível abrir o navegador de captura');
    }

    const sessao = new SessaoCaptura(
      {
        registroId,
        proxySaida: this.config.proxySaida,
        usuarioId: pedido.dados.usuarioId,
        sessaoId,
        token: randomBytes(32).toString('base64url'),
        urlInicial: pedido.dados.urlInicial,
        duracaoMaximaMs: pedido.dados.duracaoMaximaSegundos * 1000,
        ociosidadeMaximaMs: this.config.ociosidadeMaximaMs,
      },
      navegador,
      this.armazenamento,
      this.criarColetor(navegador.ip),
      this.log,
    );

    try {
      await sessao.iniciar();
      this.sessoes.adicionar(sessao);
      await this.publicador.publicar(
        criarEvento(
          'SessaoIniciada',
          {
            registroId,
            sessaoId,
            workerId: this.config.workerId,
            enderecoWorker: this.config.enderecoWorker,
            tokenSessao: sessao.dados.token,
            iniciadaEm: new Date().toISOString(),
          },
          meta,
        ),
      );
      this.log.info('sessão iniciada', { registroId, sessaoId });

      const resultado = await sessao.resultado;

      if (resultado.tipo === 'concluida') {
        await this.publicador.publicar(
          criarEvento(
            'CapturaConcluida',
            {
              registroId,
              usuarioId: pedido.dados.usuarioId,
              sessaoId,
              workerId: this.config.workerId,
              urlInicial: pedido.dados.urlInicial,
              inicio: resultado.inicio.toISOString(),
              fim: resultado.fim.toISOString(),
              artefatos: resultado.artefatos,
              metadados: resultado.metadados,
            },
            meta,
          ),
        );
        this.log.info('captura concluída', { registroId, artefatos: resultado.artefatos.length });
      } else {
        await falhar(resultado.motivo);
        this.log.info('sessão encerrada sem conclusão', { registroId, motivo: resultado.motivo });
      }
    } catch (e) {
      this.log.error('erro na sessão', { registroId, erro: String(e) });
      await sessao.falhar('Erro interno na sessão de captura');
      await falhar('Erro interno na sessão de captura');
    } finally {
      this.sessoes.remover(sessaoId);
      await navegador.destruir();
    }
  }
}
