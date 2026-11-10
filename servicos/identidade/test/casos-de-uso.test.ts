import { beforeEach, describe, expect, it } from 'vitest';
import { AutenticarUsuario } from '../src/aplicacao/autenticar-usuario';
import { CadastrarUsuario } from '../src/aplicacao/cadastrar-usuario';
import { EmissorSessao } from '../src/aplicacao/emissor-sessao';
import { EncerrarSessao } from '../src/aplicacao/encerrar-sessao';
import { RenovarSessao } from '../src/aplicacao/renovar-sessao';
import { VerificarEmail } from '../src/aplicacao/verificar-email';
import { cpfValido } from '../src/dominio/cpf';
import {
  ErroAcessoNegado,
  ErroConflito,
  ErroContaBloqueada,
  ErroCredenciais,
  ErroValidacao,
} from '../src/dominio/erros';
import { CatalogoPerfis, RegraAdvogado, RegraUsuarioComum } from '../src/dominio/regras-perfil';
import {
  EventosMemoria,
  RefreshMemoria,
  RelogioFixo,
  TokensVerificacaoMemoria,
  UsuariosMemoria,
  emissorFalso,
  geradorTokens,
  hasherFalso,
  transacaoFalsa,
} from './dubles';

const CPF = '529.982.247-25';
const advogado = {
  perfil: 'ADVOGADO',
  nome: 'Maria da Silva',
  email: 'Maria@Exemplo.com',
  senha: 'segredo123',
  cpf: CPF,
  numeroOab: 'ba 12345',
};

let usuarios: UsuariosMemoria;
let verificacao: TokensVerificacaoMemoria;
let refresh: RefreshMemoria;
let eventos: EventosMemoria;
let relogio: RelogioFixo;
let cadastrar: CadastrarUsuario;
let autenticar: AutenticarUsuario;
let renovar: RenovarSessao;
let encerrar: EncerrarSessao;
let verificarEmail: VerificarEmail;

beforeEach(() => {
  usuarios = new UsuariosMemoria();
  verificacao = new TokensVerificacaoMemoria();
  refresh = new RefreshMemoria();
  eventos = new EventosMemoria();
  relogio = new RelogioFixo();
  const perfis = new CatalogoPerfis([new RegraAdvogado(), new RegraUsuarioComum()]);
  const emissorSessao = new EmissorSessao(emissorFalso, refresh, geradorTokens, relogio);
  cadastrar = new CadastrarUsuario(perfis, usuarios, verificacao, hasherFalso, geradorTokens, eventos, transacaoFalsa, relogio);
  autenticar = new AutenticarUsuario(usuarios, hasherFalso, emissorSessao, transacaoFalsa, relogio);
  renovar = new RenovarSessao(refresh, usuarios, geradorTokens, emissorSessao, transacaoFalsa, relogio);
  encerrar = new EncerrarSessao(refresh, geradorTokens, transacaoFalsa);
  verificarEmail = new VerificarEmail(verificacao, usuarios, geradorTokens, transacaoFalsa, relogio);
});

async function cadastrarEVerificar(dados = advogado) {
  await cadastrar.executar(dados);
  const token = (eventos.emitidos.at(-1)!.dados as { tokenVerificacao: string }).tokenVerificacao;
  await verificarEmail.executar(token);
}

describe('REQ01 — cadastro', () => {
  it('valida CPF pelos dígitos verificadores', () => {
    expect(cpfValido(CPF)).toBe(true);
    expect(cpfValido('529.982.247-26')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
  });

  it('cadastra advogado normalizando e-mail, CPF e OAB, e emite UsuarioCadastrado', async () => {
    const r = await cadastrar.executar(advogado);
    const salvo = usuarios.dados.get(r.id)!;
    expect(salvo.email).toBe('maria@exemplo.com');
    expect(salvo.cpf).toBe('52998224725');
    expect(salvo.numeroOab).toBe('BA 12345');
    expect(salvo.senhaHash).not.toBe(advogado.senha);
    expect(eventos.emitidos[0].tipo).toBe('UsuarioCadastrado');
  });

  it('exige OAB para advogado, mas não para usuário comum (D1)', async () => {
    await expect(cadastrar.executar({ ...advogado, numeroOab: '' })).rejects.toMatchObject({
      detalhes: { numeroOab: expect.any(String) },
    });
    await expect(cadastrar.executar({ ...advogado, perfil: 'COMUM', numeroOab: undefined })).resolves.toBeDefined();
  });

  it('não aceita empresa nesta versão (D1)', async () => {
    await expect(cadastrar.executar({ ...advogado, perfil: 'EMPRESA' })).rejects.toBeInstanceOf(ErroValidacao);
  });

  it('aplica a política de senha e acumula erros por campo', async () => {
    const erro = await cadastrar.executar({ ...advogado, senha: 'curta', cpf: '123', nome: 'Maria' }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroValidacao);
    expect(Object.keys(erro.detalhes)).toEqual(expect.arrayContaining(['senha', 'cpf', 'nome']));
  });

  it('recusa e-mail ou CPF duplicados', async () => {
    await cadastrar.executar(advogado);
    await expect(cadastrar.executar({ ...advogado, numeroOab: 'SP 1' })).rejects.toBeInstanceOf(ErroConflito);
    await expect(
      cadastrar.executar({ ...advogado, email: 'outra@exemplo.com', numeroOab: 'SP 1' }),
    ).rejects.toMatchObject({ detalhes: { cpf: expect.any(String) } });
  });
});

describe('REQ03 — login', () => {
  it('exige e-mail verificado (ADR-0005)', async () => {
    await cadastrar.executar(advogado);
    await expect(autenticar.executar(advogado.email, advogado.senha)).rejects.toBeInstanceOf(ErroAcessoNegado);
  });

  it('entra com credenciais corretas e emite token de acesso + refresh', async () => {
    await cadastrarEVerificar();
    const { sessao, usuario } = await autenticar.executar('maria@exemplo.com', advogado.senha);
    expect(usuario.perfil).toBe('ADVOGADO');
    expect(sessao.tokenAcesso).toContain(usuario.id);
    expect(refresh.dados.size).toBe(1);
  });

  it('mesma mensagem para e-mail inexistente e senha errada', async () => {
    await cadastrarEVerificar();
    const a = await autenticar.executar('ninguem@exemplo.com', 'x').catch((e) => e);
    const b = await autenticar.executar(advogado.email, 'errada1').catch((e) => e);
    expect(a).toBeInstanceOf(ErroCredenciais);
    expect(a.message).toBe(b.message);
  });

  it('bloqueia progressivamente após 5 falhas seguidas', async () => {
    await cadastrarEVerificar();
    for (let i = 0; i < 5; i++) await autenticar.executar(advogado.email, 'errada1').catch(() => undefined);
    // Mesmo com a senha certa, a conta está bloqueada por 1 minuto.
    await expect(autenticar.executar(advogado.email, advogado.senha)).rejects.toBeInstanceOf(ErroContaBloqueada);
    relogio.avancarMinutos(2);
    await expect(autenticar.executar(advogado.email, advogado.senha)).resolves.toBeDefined();
  });
});

describe('Sessão: renovação e REQ04 — logout', () => {
  it('rotaciona o refresh token e detecta reuso revogando a família', async () => {
    await cadastrarEVerificar();
    const login = await autenticar.executar(advogado.email, advogado.senha);
    const r1 = await renovar.executar(login.sessao.refreshToken);
    expect(r1.sessao.refreshToken).not.toBe(login.sessao.refreshToken);

    // Reapresentar o token antigo = indício de roubo → família inteira revogada.
    await expect(renovar.executar(login.sessao.refreshToken)).rejects.toBeInstanceOf(ErroCredenciais);
    await expect(renovar.executar(r1.sessao.refreshToken)).rejects.toBeInstanceOf(ErroCredenciais);
  });

  it('logout revoga o refresh token da sessão', async () => {
    await cadastrarEVerificar();
    const login = await autenticar.executar(advogado.email, advogado.senha);
    await encerrar.executar(login.sessao.refreshToken, login.usuario.id);
    await expect(renovar.executar(login.sessao.refreshToken)).rejects.toBeInstanceOf(ErroCredenciais);
  });

  it('logout não revoga sessão de outro usuário', async () => {
    await cadastrarEVerificar();
    const login = await autenticar.executar(advogado.email, advogado.senha);
    await encerrar.executar(login.sessao.refreshToken, 'outro-usuario');
    await expect(renovar.executar(login.sessao.refreshToken)).resolves.toBeDefined();
  });

  it('refresh token expira em 7 dias', async () => {
    await cadastrarEVerificar();
    const login = await autenticar.executar(advogado.email, advogado.senha);
    relogio.avancarMinutos(7 * 24 * 60 + 1);
    await expect(renovar.executar(login.sessao.refreshToken)).rejects.toBeInstanceOf(ErroCredenciais);
  });

  it('link de verificação de e-mail é de uso único', async () => {
    await cadastrar.executar(advogado);
    const token = (eventos.emitidos[0].dados as { tokenVerificacao: string }).tokenVerificacao;
    await verificarEmail.executar(token);
    await expect(verificarEmail.executar(token)).rejects.toBeInstanceOf(ErroValidacao);
  });
});
