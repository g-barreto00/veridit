import type { Pool } from 'pg';

/**
 * Consulta de saldo e extrato para a interface (leitura). Por ser só leitura e não ter regra
 * de negócio, consulta direto o banco (separação comando/consulta).
 */
export class ConsultarCarteira {
  constructor(private readonly pool: Pool) {}

  async saldo(usuarioId: string) {
    const { rows } = await this.pool.query(
      'SELECT saldo_disponivel, saldo_reservado FROM carteiras WHERE usuario_id = $1',
      [usuarioId],
    );
    return {
      disponivel: rows[0]?.saldo_disponivel ?? 0,
      reservado: rows[0]?.saldo_reservado ?? 0,
    };
  }

  async extrato(usuarioId: string, limite = 50) {
    const { rows } = await this.pool.query(
      `SELECT id, tipo, creditos, descricao, criado_em AS "criadoEm"
         FROM lancamentos WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT $2`,
      [usuarioId, Math.min(limite, 200)],
    );
    return rows;
  }
}
