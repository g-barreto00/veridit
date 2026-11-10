import type {
  CapturaConcluida,
  CapturaFalhou,
  EvidenciaSelada,
  SelagemFalhou,
  SessaoIniciada,
} from '@veridit/contratos';
import { criarEvento, type Registrador } from '@veridit/mensageria';
import { ErroEstado, ErroNaoEncontrado } from '../dominio/erros';
import {
  ReservaEmEstadoInvalido,
  type AlocadorSessao,
  type CarteiraCreditos,
  type ExecutorTransacao,
  type RegistradorEventos,
  type RepositorioRegistros,
  type Relogio,
  type Transacao,
} from '../dominio/portas';
import { PRAZOS_MS, type Registro } from '../dominio/registro';

/** Evento chegou antes do anterior (ex.: CapturaConcluida antes de SessaoIniciada): tentar de novo depois. */
export class ForaDeOrdem extends Error {}

/**
 * Coordenador da Saga (C11). Reage aos eventos de Captura e Evidências e às ações do usuário,
 * aplicando as transições do diagrama c11-estados e as compensações (estorno da reserva).
 * Eventos que não combinam com o estado atual são ignorados (idempotência pelo estado).
 */
export class CoordenadorSaga {
  constructor(
    private readonly registros: RepositorioRegistros,
    private readonly carteira: CarteiraCreditos,
    private readonly alocador: AlocadorSessao,
    private readonly eventos: RegistradorEventos,
    private readonly transacao: ExecutorTransacao,
    private readonly relogio: Relogio,
    private readonly log: Registrador,
  ) {}

  async aoSessaoIniciada(tx: Transacao, e: SessaoIniciada): Promise<void> {
    const r = await this.registros.carregarParaAlterar(tx, e.dados.registroId);
    if (!r || r.status !== 'AGUARDANDO_SESSAO') return this.ignorar(e.tipo, r);

    r.transicionar('EM_CAPTURA', this.relogio.agora(), 'Sessão iniciada', {
      sessaoId: e.dados.sessaoId,
      workerId: e.dados.workerId,
    });
    await this.registros.salvar(tx, r);
    // Alocador de Sessão: o gateway passa a encaminhar o WebSocket desta sessão ao worker.
    await this.alocador.registrar(
      {
        registroId: r.id,
        usuarioId: r.usuarioId,
        sessaoId: e.dados.sessaoId,
        enderecoWorker: e.dados.enderecoWorker,
      },
      PRAZOS_MS.EM_CAPTURA!,
    );
  }

  async aoCapturaConcluida(tx: Transacao, e: CapturaConcluida): Promise<void> {
    const r = await this.registros.carregarParaAlterar(tx, e.dados.registroId);
    if (r?.status === 'AGUARDANDO_SESSAO') throw new ForaDeOrdem('SessaoIniciada ainda não processada');
    if (!r || r.status !== 'EM_CAPTURA') return this.ignorar(e.tipo, r);

    r.transicionar('SELANDO', this.relogio.agora(), 'Captura concluída');
    await this.registros.salvar(tx, r);
    await this.alocador.remover(r.id);
  }

  async aoCapturaFalhou(tx: Transacao, e: CapturaFalhou): Promise<void> {
    await this.falhar(tx, e.dados.registroId, e.dados.motivo || 'Falha na captura');
  }

  async aoSelagemFalhou(tx: Transacao, e: SelagemFalhou): Promise<void> {
    await this.falhar(tx, e.dados.registroId, `Falha na selagem: ${e.dados.motivo}`);
  }

  async aoEvidenciaSelada(tx: Transacao, e: EvidenciaSelada): Promise<void> {
    const r = await this.registros.carregarParaAlterar(tx, e.dados.registroId);
    if (r?.status === 'EM_CAPTURA') throw new ForaDeOrdem('CapturaConcluida ainda não processada');
    if (!r || r.status !== 'SELANDO') return this.ignorar(e.tipo, r);

    try {
      await this.carteira.consumir(r.id);
    } catch (erro) {
      if (!(erro instanceof ReservaEmEstadoInvalido)) throw erro; // indisponível → retentativa
      // A reserva expirou e foi estornada antes da selagem. A evidência já está selada e
      // imutável: conclui assim mesmo e registra para conferência.
      this.log.warn('registro concluído sem consumo de créditos (reserva expirada)', { registroId: r.id });
    }

    const agora = this.relogio.agora();
    r.transicionar('CONCLUIDO', agora, 'Evidência selada', {
      quantidadeImagens: e.dados.quantidadeImagens,
      quantidadeVideos: e.dados.quantidadeVideos,
      hashManifesto: e.dados.hashManifesto,
    });
    await this.registros.salvar(tx, r);
    // Notificações usa este evento na sprint 2 (REQ10 / REQ11-B).
    await this.eventos.registrar(
      tx,
      criarEvento(
        'RegistroConcluido',
        { registroId: r.id, usuarioId: r.usuarioId, tipo: r.estado.tipo, titulo: r.estado.titulo, concluidoEm: agora.toISOString() },
        { correlationId: r.id, origem: 'registros' },
      ),
    );
  }

  /** Usuário cancela o registro em andamento (diagrama: EmCaptura → Cancelado). */
  async cancelar(usuarioId: string, registroId: string) {
    return this.transacao.executar(async (tx) => {
      const r = await this.registros.carregarParaAlterar(tx, registroId);
      if (!r || r.usuarioId !== usuarioId) throw new ErroNaoEncontrado('Registro não encontrado');
      if (!r.podeIrPara('CANCELADO')) throw new ErroEstado('Este registro não pode mais ser cancelado');
      await this.carteira.estornar(r.id, 'Registro cancelado pelo usuário');
      r.transicionar('CANCELADO', this.relogio.agora(), 'Cancelado pelo usuário');
      await this.registros.salvar(tx, r);
      await this.alocador.remover(r.id);
      return { id: r.id, status: r.status };
    });
  }

  /** Monitor de Prazos (C11): sessões que não iniciaram, passaram da duração ou travaram. */
  async monitorarPrazos(): Promise<number> {
    const ids = await this.registros.comPrazoVencido(this.relogio.agora(), 50);
    let falhas = 0;
    for (const id of ids) {
      try {
        await this.transacao.executar(async (tx) => {
          const r = await this.registros.carregarParaAlterar(tx, id);
          if (!r || r.finalizado || !r.prazoVencido(this.relogio.agora())) return;
          await this.falharRegistro(tx, r, `Tempo esgotado (${r.status})`);
          falhas++;
        });
      } catch (erro) {
        this.log.warn('não foi possível encerrar registro com prazo vencido', { registroId: id, erro: String(erro) });
      }
    }
    if (falhas) this.log.info('registros encerrados por prazo', { quantidade: falhas });
    return falhas;
  }

  private async falhar(tx: Transacao, registroId: string, motivo: string) {
    const r = await this.registros.carregarParaAlterar(tx, registroId);
    if (!r || !r.podeIrPara('FALHOU')) return this.ignorar('falha', r);
    await this.falharRegistro(tx, r, motivo);
  }

  /** Compensação: estorna a reserva (idempotente) antes de gravar o estado Falhou. */
  private async falharRegistro(tx: Transacao, r: Registro, motivo: string) {
    if (r.temReserva || r.status === 'INICIADO') await this.carteira.estornar(r.id, motivo);
    r.transicionar('FALHOU', this.relogio.agora(), motivo);
    await this.registros.salvar(tx, r);
    await this.alocador.remover(r.id);
  }

  private ignorar(evento: string, r?: Registro) {
    this.log.info('evento ignorado pelo estado atual da saga', { evento, registroId: r?.id, status: r?.status });
  }
}
