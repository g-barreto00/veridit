import type { Pool, PoolClient } from 'pg';
import type { Envelope } from '@veridit/contratos';
import type { GuardaIdempotencia } from '../portas';

/**
 * Idempotência no consumidor (ADR-0007): marca o evento como processado na MESMA transação
 * em que o manipulador altera o estado. Se o evento chegar de novo, a inserção conflita e a
 * ação não é executada. Se a ação falhar, o rollback desfaz também a marcação.
 */
export class GuardaIdempotenciaPg implements GuardaIdempotencia {
  constructor(private readonly pool: Pool) {}

  async executarUmaVez(
    evento: Envelope,
    consumidor: string,
    acao: (transacao?: PoolClient) => Promise<void>,
  ): Promise<'processado' | 'duplicado'> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const { rowCount } = await cliente.query(
        `INSERT INTO mensagens_processadas (id_evento, consumidor) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [evento.id, consumidor],
      );
      if (rowCount === 0) {
        await cliente.query('ROLLBACK');
        return 'duplicado';
      }
      await acao(cliente);
      await cliente.query('COMMIT');
      return 'processado';
    } catch (erro) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw erro;
    } finally {
      cliente.release();
    }
  }
}
