import type { Pool } from 'pg';
import type {
  RefreshToken,
  RepositorioRefreshTokens,
  RepositorioTokensVerificacao,
  Transacao,
} from '../dominio/portas';
import { cliente } from './transacao-pg';

export class RepositorioTokensVerificacaoPg implements RepositorioTokensVerificacao {
  async salvar(tx: Transacao, tokenHash: string, usuarioId: string, expiraEm: Date) {
    await cliente(tx).query(
      'INSERT INTO tokens_verificacao_email (token_hash, usuario_id, expira_em) VALUES ($1, $2, $3)',
      [tokenHash, usuarioId, expiraEm],
    );
  }

  async consumir(tx: Transacao, tokenHash: string, agora: Date) {
    const { rows } = await cliente(tx).query<{ usuario_id: string }>(
      `UPDATE tokens_verificacao_email SET usado_em = $2
        WHERE token_hash = $1 AND usado_em IS NULL AND expira_em > $2
        RETURNING usuario_id`,
      [tokenHash, agora],
    );
    return rows[0]?.usuario_id;
  }
}

export class RepositorioRefreshTokensPg implements RepositorioRefreshTokens {
  constructor(private readonly pool: Pool) {}

  async salvar(tx: Transacao, t: RefreshToken, tokenHash: string) {
    await cliente(tx).query(
      `INSERT INTO refresh_tokens (id, familia_id, usuario_id, token_hash, expira_em)
       VALUES ($1, $2, $3, $4, $5)`,
      [t.id, t.familiaId, t.usuarioId, tokenHash, t.expiraEm],
    );
  }

  async buscarPorHash(tx: Transacao, tokenHash: string): Promise<RefreshToken | undefined> {
    // FOR UPDATE: duas renovações simultâneas com o mesmo token não geram dois pares válidos.
    const { rows } = await cliente(tx).query(
      'SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
      [tokenHash],
    );
    const l = rows[0];
    return (
      l && {
        id: l.id,
        familiaId: l.familia_id,
        usuarioId: l.usuario_id,
        expiraEm: l.expira_em,
        substituidoPor: l.substituido_por ?? undefined,
        revogadoEm: l.revogado_em ?? undefined,
      }
    );
  }

  async marcarSubstituido(tx: Transacao, id: string, novoId: string) {
    await cliente(tx).query('UPDATE refresh_tokens SET substituido_por = $2 WHERE id = $1', [id, novoId]);
  }

  async revogarFamilia(familiaId: string) {
    await this.pool.query(
      'UPDATE refresh_tokens SET revogado_em = now() WHERE familia_id = $1 AND revogado_em IS NULL',
      [familiaId],
    );
  }

  async revogarTodosDoUsuario(usuarioId: string) {
    await this.pool.query(
      'UPDATE refresh_tokens SET revogado_em = now() WHERE usuario_id = $1 AND revogado_em IS NULL',
      [usuarioId],
    );
  }
}
