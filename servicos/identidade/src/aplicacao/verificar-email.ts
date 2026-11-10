import { ErroValidacao } from '../dominio/erros';
import type {
  ExecutorTransacao,
  GeradorTokens,
  RepositorioTokensVerificacao,
  RepositorioUsuarios,
  Relogio,
} from '../dominio/portas';

/** Verificação de e-mail no cadastro (ADR-0005). */
export class VerificarEmail {
  constructor(
    private readonly tokensVerificacao: RepositorioTokensVerificacao,
    private readonly usuarios: RepositorioUsuarios,
    private readonly tokens: GeradorTokens,
    private readonly transacao: ExecutorTransacao,
    private readonly relogio: Relogio,
  ) {}

  async executar(token: string): Promise<void> {
    const agora = this.relogio.agora();
    const ok = await this.transacao.executar(async (tx) => {
      const usuarioId = await this.tokensVerificacao.consumir(tx, this.tokens.hash(token ?? ''), agora);
      if (!usuarioId) return false;
      await this.usuarios.marcarEmailVerificado(tx, usuarioId, agora);
      return true;
    });
    if (!ok) throw new ErroValidacao('Link de verificação inválido ou expirado');
  }
}
