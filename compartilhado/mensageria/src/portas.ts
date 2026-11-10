import type { PoolClient } from 'pg';
import type { Envelope } from '@veridit/contratos';

/**
 * Portas (interfaces) da mensageria. Os serviços dependem destas abstrações, não do RabbitMQ
 * nem do PostgreSQL diretamente (SOLID: inversão de dependência e segregação de interfaces).
 */

/** Publica um evento já pronto no broker. Usado pelo relay do outbox e pelo worker de captura. */
export interface PublicadorEventos {
  publicar(evento: Envelope): Promise<void>;
}

/** Grava eventos na mesma transação da mudança de estado (outbox transacional). */
export interface Outbox {
  adicionar(transacao: PoolClient, evento: Envelope): Promise<void>;
}

/** Contexto entregue ao manipulador de um evento. */
export interface ContextoConsumo {
  /** Transação aberta pela guarda de idempotência (undefined quando o consumidor não usa banco). */
  transacao?: PoolClient;
  tentativa: number;
  /** O broker já entregou esta mensagem antes (ex.: o consumidor caiu sem dar ack). */
  reentregue: boolean;
}

export type ManipuladorEvento<E extends Envelope = Envelope> = (
  evento: E,
  contexto: ContextoConsumo,
) => Promise<void>;

/**
 * Garante que um evento seja processado no máximo uma vez por consumidor.
 * Implementações: PostgreSQL (serviços com banco) e sem estado (worker de captura, ADR-0009).
 */
export interface GuardaIdempotencia {
  executarUmaVez(
    evento: Envelope,
    consumidor: string,
    acao: (transacao?: PoolClient) => Promise<void>,
  ): Promise<'processado' | 'duplicado'>;
}
