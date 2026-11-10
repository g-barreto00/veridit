import type { Envelope } from '@veridit/contratos';
import type { GuardaIdempotencia } from '../portas';

/**
 * Para consumidores sem banco (worker de captura, ADR-0009). A deduplicação fica a cargo de
 * quem recebe o resultado: o orquestrador (Registros) ignora eventos que não combinam com o
 * estado atual da saga.
 */
export class GuardaSemEstado implements GuardaIdempotencia {
  async executarUmaVez(
    _evento: Envelope,
    _consumidor: string,
    acao: () => Promise<void>,
  ): Promise<'processado'> {
    await acao();
    return 'processado';
  }
}
