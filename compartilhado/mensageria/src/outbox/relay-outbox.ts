import type { PublicadorEventos } from '../portas';
import type { RepositorioRelayOutboxPg } from './outbox-pg';

export interface OpcoesRelay {
  intervaloMs?: number;
  tamanhoLote?: number;
  aoErro?: (erro: unknown) => void;
}

/**
 * Relay do outbox: lê eventos gravados na transação de negócio e publica no broker.
 * Se o serviço cair entre o COMMIT e a publicação, o evento continua pendente e é
 * publicado no próximo ciclo (entrega "pelo menos uma vez"; consumidores são idempotentes).
 */
export class RelayOutbox {
  private temporizador?: NodeJS.Timeout;
  private executando = false;

  constructor(
    private readonly repositorio: RepositorioRelayOutboxPg,
    private readonly publicador: PublicadorEventos,
    private readonly opcoes: OpcoesRelay = {},
  ) {}

  iniciar(): void {
    const intervalo = this.opcoes.intervaloMs ?? 500;
    this.temporizador = setInterval(() => void this.ciclo(), intervalo);
  }

  parar(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /** Publica tudo que estiver pendente agora. Exposto para testes. */
  async ciclo(): Promise<void> {
    if (this.executando) return;
    this.executando = true;
    try {
      const lote = this.opcoes.tamanhoLote ?? 50;
      // Continua enquanto vierem lotes cheios.
      while ((await this.repositorio.processarLote(lote, (e) => this.publicador.publicar(e))) === lote);
    } catch (erro) {
      this.opcoes.aoErro?.(erro);
    } finally {
      this.executando = false;
    }
  }
}
