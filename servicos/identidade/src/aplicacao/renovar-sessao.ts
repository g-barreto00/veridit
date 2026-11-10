import { ErroCredenciais } from '../dominio/erros';
import type {
  ExecutorTransacao,
  GeradorTokens,
  RepositorioRefreshTokens,
  RepositorioUsuarios,
  Relogio,
} from '../dominio/portas';
import type { EmissorSessao } from './emissor-sessao';

/**
 * Troca um refresh token por um novo par (rotação, ADR-0005). Se um token já trocado for
 * reapresentado, é indício de roubo: toda a família é revogada.
 */
export class RenovarSessao {
  constructor(
    private readonly refreshTokens: RepositorioRefreshTokens,
    private readonly usuarios: RepositorioUsuarios,
    private readonly tokens: GeradorTokens,
    private readonly emissorSessao: EmissorSessao,
    private readonly transacao: ExecutorTransacao,
    private readonly relogio: Relogio,
  ) {}

  async executar(refreshToken: string | undefined) {
    if (!refreshToken) throw new ErroCredenciais('Sessão expirada');
    const agora = this.relogio.agora();
    let familiaParaRevogar: string | undefined;

    const resultado = await this.transacao.executar(async (tx) => {
      const atual = await this.refreshTokens.buscarPorHash(tx, this.tokens.hash(refreshToken));
      if (!atual) return undefined;
      if (atual.substituidoPor || atual.revogadoEm) {
        familiaParaRevogar = atual.familiaId;
        return undefined;
      }
      if (atual.expiraEm <= agora) return undefined;

      const usuario = await this.usuarios.buscarPorId(atual.usuarioId);
      if (!usuario) return undefined;

      const nova = await this.emissorSessao.emitir(tx, usuario, atual.familiaId);
      await this.refreshTokens.marcarSubstituido(tx, atual.id, nova.refreshId);
      return {
        sessao: nova,
        usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
      };
    });

    if (familiaParaRevogar) {
      await this.refreshTokens.revogarFamilia(familiaParaRevogar);
      throw new ErroCredenciais('Sessão revogada por segurança. Entre novamente.');
    }
    if (!resultado) throw new ErroCredenciais('Sessão expirada');
    return resultado;
  }
}
