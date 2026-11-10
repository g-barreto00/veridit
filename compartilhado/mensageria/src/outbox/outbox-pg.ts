import type { Pool, PoolClient } from 'pg';
import type { Envelope } from '@veridit/contratos';
import type { Outbox } from '../portas';

/** Outbox transacional em PostgreSQL (ADR-0007). */
export class OutboxPg implements Outbox {
  async adicionar(transacao: PoolClient, evento: Envelope): Promise<void> {
    await transacao.query('INSERT INTO outbox (id, tipo, payload) VALUES ($1, $2, $3)', [
      evento.id,
      evento.tipo,
      JSON.stringify(evento),
    ]);
  }
}

/** Operações de leitura/baixa do outbox usadas apenas pelo relay. */
export class RepositorioRelayOutboxPg {
  constructor(private readonly pool: Pool) {}

  /**
   * Bloqueia um lote de eventos pendentes (SKIP LOCKED permite várias réplicas do relay)
   * e chama `publicar` para cada um dentro da mesma transação.
   */
  async processarLote(
    tamanho: number,
    publicar: (evento: Envelope) => Promise<void>,
  ): Promise<number> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const { rows } = await cliente.query<{ id: string; payload: Envelope }>(
        `SELECT id, payload FROM outbox
          WHERE publicado_em IS NULL
          ORDER BY criado_em
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [tamanho],
      );
      for (const linha of rows) {
        try {
          await publicar(linha.payload);
          await cliente.query('UPDATE outbox SET publicado_em = now() WHERE id = $1', [linha.id]);
        } catch (erro) {
          await cliente.query(
            'UPDATE outbox SET tentativas = tentativas + 1, ultimo_erro = $2 WHERE id = $1',
            [linha.id, String(erro)],
          );
          // Para o lote para preservar a ordem; o próximo ciclo tenta de novo.
          break;
        }
      }
      await cliente.query('COMMIT');
      return rows.length;
    } catch (erro) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw erro;
    } finally {
      cliente.release();
    }
  }
}
