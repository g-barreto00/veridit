import { randomUUID } from 'node:crypto';
import { criarEvento } from '@veridit/mensageria';
import { cpfValido, normalizarCpf } from '../dominio/cpf';
import { ErroConflito, ErroValidacao } from '../dominio/erros';
import { violacoesSenha } from '../dominio/politica-senha';
import type {
  ExecutorTransacao,
  GeradorTokens,
  HasherSenha,
  RegistradorEventos,
  RepositorioTokensVerificacao,
  RepositorioUsuarios,
  Relogio,
} from '../dominio/portas';
import type { CatalogoPerfis } from '../dominio/regras-perfil';
import { normalizarEmail, type DadosCadastro, type Usuario } from '../dominio/usuario';

const VALIDADE_VERIFICACAO_MS = 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** REQ01 — Cadastrar usuário (advogado ou usuário comum, D1). */
export class CadastrarUsuario {
  constructor(
    private readonly perfis: CatalogoPerfis,
    private readonly usuarios: RepositorioUsuarios,
    private readonly tokensVerificacao: RepositorioTokensVerificacao,
    private readonly hasher: HasherSenha,
    private readonly tokens: GeradorTokens,
    private readonly eventos: RegistradorEventos,
    private readonly transacao: ExecutorTransacao,
    private readonly relogio: Relogio,
  ) {}

  async executar(dados: DadosCadastro) {
    const regra = this.perfis.obter(dados.perfil);
    if (!regra) {
      throw new ErroValidacao('Dados inválidos', {
        perfil: `Perfil deve ser um de: ${this.perfis.habilitados().join(', ')}`,
      });
    }

    const nome = (dados.nome ?? '').trim().replace(/\s+/g, ' ');
    const email = normalizarEmail(dados.email);
    const cpf = normalizarCpf(dados.cpf);

    const erros: Record<string, string> = { ...regra.validar(dados) };
    if (nome.split(' ').length < 2 || nome.length < 5) erros.nome = 'Informe o nome completo';
    if (!EMAIL_RE.test(email)) erros.email = 'E-mail inválido';
    if (!cpfValido(cpf)) erros.cpf = 'CPF inválido';
    const senha = violacoesSenha(dados.senha);
    if (senha.length) erros.senha = `A senha deve ${senha.join(', ')}`;
    if (Object.keys(erros).length) throw new ErroValidacao('Dados inválidos', erros);

    const { numeroOab } = regra.camposEspecificos(dados);
    if (await this.usuarios.emailEmUso(email)) throw new ErroConflito('E-mail já cadastrado', { email: 'E-mail já cadastrado' });
    if (await this.usuarios.cpfEmUso(cpf)) throw new ErroConflito('CPF já cadastrado', { cpf: 'CPF já cadastrado' });
    if (numeroOab && (await this.usuarios.oabEmUso(numeroOab))) {
      throw new ErroConflito('OAB já cadastrada', { numeroOab: 'Número da OAB já cadastrado' });
    }

    const agora = this.relogio.agora();
    const usuario: Usuario = {
      id: randomUUID(),
      perfil: regra.perfil,
      nome,
      email,
      senhaHash: await this.hasher.gerar(dados.senha),
      cpf,
      numeroOab,
      falhasLogin: 0,
      criadoEm: agora,
    };
    const tokenVerificacao = this.tokens.gerar();

    await this.transacao.executar(async (tx) => {
      await this.usuarios.inserir(tx, usuario);
      await this.tokensVerificacao.salvar(
        tx,
        this.tokens.hash(tokenVerificacao),
        usuario.id,
        new Date(agora.getTime() + VALIDADE_VERIFICACAO_MS),
      );
      // Mesmo commit: usuário, token e evento (outbox) — ADR-0007.
      await this.eventos.registrar(
        tx,
        criarEvento(
          'UsuarioCadastrado',
          { usuarioId: usuario.id, nome, email, perfil: regra.perfil as 'ADVOGADO' | 'COMUM', tokenVerificacao },
          { correlationId: usuario.id, origem: 'identidade' },
        ),
      );
    });

    return { id: usuario.id, perfil: usuario.perfil, nome, email };
  }
}
