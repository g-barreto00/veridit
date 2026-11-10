import type { ExecutorTransacao, GeradorTokens, RepositorioRefreshTokens } from '../dominio/portas';

/**
 * REQ04 — Sair do sistema. Revoga a família do refresh token desta sessão. O token de acesso
 * (jti) é colocado na lista de revogação pelo API Gateway (ADR-0005).
 */
export class EncerrarSessao {
  constructor(
    private readonly refreshTokens: RepositorioRefreshTokens,
    private readonly tokens: GeradorTokens,
    private readonly transacao: ExecutorTransacao,
  ) {}

  async executar(refreshToken: string | undefined, usuarioId: string): Promise<void> {
    if (!refreshToken) return;
    const atual = await this.transacao.executar((tx) =>
      this.refreshTokens.buscarPorHash(tx, this.tokens.hash(refreshToken)),
    );
    // Só revoga se o token pertence ao usuário autenticado.
    if (atual && atual.usuarioId === usuarioId) await this.refreshTokens.revogarFamilia(atual.familiaId);
  }
}
