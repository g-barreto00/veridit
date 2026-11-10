import type { Pool, PoolClient } from 'pg';
import { transacao } from '@veridit/plataforma';
import type { Envelope } from '@veridit/contratos';
import { OutboxPg } from '@veridit/mensageria';
import type { ExecutorTransacao, RegistradorEventos, Relogio, Transacao } from '../dominio/portas';

/** Converte a transação opaca do domínio de volta ao cliente PostgreSQL (só a infra faz isso). */
export const cliente = (tx: Transacao) => tx as unknown as PoolClient;

export class ExecutorTransacaoPg implements ExecutorTransacao {
  constructor(private readonly pool: Pool) {}
  executar<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
    return transacao(this.pool, (c) => fn(c as unknown as Transacao));
  }
}

/** Adapta a porta de eventos do domínio ao outbox transacional (ADR-0007). */
export class RegistradorEventosOutbox implements RegistradorEventos {
  private readonly outbox = new OutboxPg();
  registrar(tx: Transacao, evento: Envelope): Promise<void> {
    return this.outbox.adicionar(cliente(tx), evento);
  }
}

export class RelogioSistema implements Relogio {
  agora(): Date {
    return new Date();
  }
}
