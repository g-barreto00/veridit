import { ErroAcessoNegado, ErroContaBloqueada, ErroCredenciais } from '../dominio/erros';
import type { ExecutorTransacao, HasherSenha, RepositorioUsuarios, Relogio } from '../dominio/portas';
import { calcularBloqueio, normalizarEmail } from '../dominio/usuario';
import type { EmissorSessao } from './emissor-sessao';

const MENSAGEM_GENERICA = 'E-mail ou senha inválidos';

/** REQ03 — Logar no sistema. */
export class AutenticarUsuario {
  /** Hash fixo usado quando o e-mail não existe, para o tempo de resposta não revelar isso. */
  private hashFicticio?: Promise<string>;

  constructor(
    private readonly usuarios: RepositorioUsuarios,
    private readonly hasher: HasherSenha,
    private readonly emissorSessao: EmissorSessao,
    private readonly transacao: ExecutorTransacao,
    private readonly relogio: Relogio,
  ) {}

  async executar(emailInformado: string, senha: string) {
    const agora = this.relogio.agora();
    const usuario = await this.usuarios.buscarPorEmail(normalizarEmail(emailInformado));

    if (!usuario) {
      this.hashFicticio ??= this.hasher.gerar('senha-ficticia-para-tempo-constante');
      await this.hasher.verificar(await this.hashFicticio, senha ?? '');
      throw new ErroCredenciais(MENSAGEM_GENERICA);
    }

    if (usuario.bloqueadoAte && usuario.bloqueadoAte > agora) {
      throw new ErroContaBloqueada(usuario.bloqueadoAte);
    }

    if (!(await this.hasher.verificar(usuario.senhaHash, senha ?? ''))) {
      const falhas = usuario.falhasLogin + 1;
      await this.usuarios.registrarFalhaLogin(usuario.id, falhas, calcularBloqueio(falhas, agora));
      throw new ErroCredenciais(MENSAGEM_GENERICA);
    }

    if (usuario.falhasLogin > 0) await this.usuarios.zerarFalhasLogin(usuario.id);

    if (!usuario.emailVerificadoEm) {
      throw new ErroAcessoNegado('Confirme seu e-mail pelo link enviado antes de entrar.');
    }

    const sessao = await this.transacao.executar((tx) => this.emissorSessao.emitir(tx, usuario));
    return {
      sessao,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
    };
  }
}
