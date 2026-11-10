import { randomUUID } from 'node:crypto';
import type {
  EmissorTokenAcesso,
  GeradorTokens,
  RepositorioRefreshTokens,
  Relogio,
  Transacao,
} from '../dominio/portas';
import type { Usuario } from '../dominio/usuario';

export const VALIDADE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias (ADR-0005)

export interface SessaoEmitida {
  tokenAcesso: string;
  jti: string;
  acessoExpiraEm: Date;
  refreshToken: string;
  refreshExpiraEm: Date;
}

/** Emite o par token de acesso + refresh token. Usado no login e na renovação. */
export class EmissorSessao {
  constructor(
    private readonly emissorAcesso: EmissorTokenAcesso,
    private readonly refreshTokens: RepositorioRefreshTokens,
    private readonly tokens: GeradorTokens,
    private readonly relogio: Relogio,
  ) {}

  async emitir(tx: Transacao, usuario: Usuario, familiaId: string = randomUUID()): Promise<SessaoEmitida & { refreshId: string }> {
    const acesso = await this.emissorAcesso.emitir(usuario);
    const refreshToken = this.tokens.gerar();
    const refreshId = randomUUID();
    const refreshExpiraEm = new Date(this.relogio.agora().getTime() + VALIDADE_REFRESH_MS);
    await this.refreshTokens.salvar(
      tx,
      { id: refreshId, familiaId, usuarioId: usuario.id, expiraEm: refreshExpiraEm },
      this.tokens.hash(refreshToken),
    );
    return {
      tokenAcesso: acesso.token,
      jti: acesso.jti,
      acessoExpiraEm: acesso.expiraEm,
      refreshToken,
      refreshExpiraEm,
      refreshId,
    };
  }
}
