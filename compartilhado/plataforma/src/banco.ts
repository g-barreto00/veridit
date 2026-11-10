import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';

/** Pool do serviço. O usuário de banco do serviço só tem permissão no próprio esquema (ADR-0010). */
export function criarPool(urlConexao: string): Pool {
  return new Pool({ connectionString: urlConexao, max: 10 });
}

/**
 * Migrações SQL versionadas por arquivo (`001-xxx.sql`, `002-yyy.sql`...). Aplicadas na
 * inicialização, em ordem, uma única vez, com lock para várias réplicas subirem juntas.
 */
export async function migrar(pool: Pool, pastaSql: string, sqlExtra: string[] = []): Promise<string[]> {
  const cliente = await pool.connect();
  const aplicadas: string[] = [];
  try {
    await cliente.query('SELECT pg_advisory_lock(hashtext(current_schema()))');
    await cliente.query(`CREATE TABLE IF NOT EXISTS migracoes (
      nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
    for (const sql of sqlExtra) await cliente.query(sql);

    const arquivos = readdirSync(pastaSql).filter((a) => a.endsWith('.sql')).sort();
    for (const arquivo of arquivos) {
      const { rowCount } = await cliente.query('SELECT 1 FROM migracoes WHERE nome = $1', [arquivo]);
      if (rowCount) continue;
      await emTransacao(cliente, async () => {
        await cliente.query(readFileSync(join(pastaSql, arquivo), 'utf8'));
        await cliente.query('INSERT INTO migracoes (nome) VALUES ($1)', [arquivo]);
      });
      aplicadas.push(arquivo);
    }
  } finally {
    await cliente.query('SELECT pg_advisory_unlock(hashtext(current_schema()))').catch(() => undefined);
    cliente.release();
  }
  return aplicadas;
}

async function emTransacao(cliente: PoolClient, fn: () => Promise<void>) {
  await cliente.query('BEGIN');
  try {
    await fn();
    await cliente.query('COMMIT');
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  }
}

/** Executa `fn` numa transação de um cliente do pool. */
export async function transacao<T>(pool: Pool, fn: (cliente: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    cliente.release();
  }
}
