import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Mail, MailCheck } from 'lucide-react';
import { ErroApi, api } from '../api/cliente';
import { Campo, LayoutAcesso } from '../componentes/comuns';
import { useSessao } from '../sessao';

/** Tela 01 — Entrar (REQ03). */
export function Entrar() {
  const { entrar, usuario } = useSessao();
  const navegar = useNavigate();
  const local = useLocation();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [avisoSenha, setAvisoSenha] = useState(false);

  useEffect(() => {
    if (usuario) navegar((local.state as { de?: string })?.de ?? '/registros', { replace: true });
  }, [usuario, navegar, local.state]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await entrar(email, senha);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : 'Não foi possível entrar agora.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <LayoutAcesso etiqueta="REQ03 · Segurança" estreito>
      <h1>Entrar</h1>
      <p className="subtitulo">Acesse sua conta para registrar e consultar conteúdos.</p>
      {erro && <div className="alerta erro" role="alert">{erro}</div>}
      {avisoSenha && <div className="alerta info">A recuperação de senha (REQ02) chega na próxima versão.</div>}
      <form onSubmit={enviar}>
        <Campo rotulo="E-mail" name="email" type="email" required autoComplete="email" icone={<Mail size={18} />} value={email} onChange={(e) => setEmail(e.target.value)} />
        <div style={{ position: 'relative' }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setAvisoSenha(true); }} style={{ position: 'absolute', right: 0, top: 0, fontSize: 13 }}>
            Esqueci minha senha
          </a>
          <Campo rotulo="Senha" name="senha" type="password" required autoComplete="current-password" icone={<Lock size={18} />} value={senha} onChange={(e) => setSenha(e.target.value)} />
        </div>
        <button className="botao primario largo" disabled={enviando} style={{ marginTop: 8 }}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <div className="separador" />
      <p style={{ textAlign: 'center', color: 'var(--suave)', margin: '0 0 12px' }}>Ainda não tem conta?</p>
      <Link to="/criar-conta" className="botao secundario largo">Criar conta</Link>
    </LayoutAcesso>
  );
}

const formatarCpf = (v: string) =>
  v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');

/** Tela 02 — Criar conta (REQ01; D1: advogado e usuário comum; empresa em breve). */
export function CriarConta() {
  const [perfil, setPerfil] = useState<'ADVOGADO' | 'COMUM'>('ADVOGADO');
  const [dados, setDados] = useState({ nome: '', email: '', cpf: '', numeroOab: '', senha: '', confirmacao: '' });
  const [aceite, setAceite] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [criado, setCriado] = useState('');

  const alterar = (campo: keyof typeof dados) => (e: { target: { value: string } }) =>
    setDados({ ...dados, [campo]: campo === 'cpf' ? formatarCpf(e.target.value) : e.target.value });

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (dados.senha !== dados.confirmacao) return setErros({ confirmacao: 'As senhas não conferem' });
    setErros({});
    setEnviando(true);
    try {
      await api.publico('POST', '/api/auth/cadastro', {
        perfil,
        nome: dados.nome,
        email: dados.email,
        cpf: dados.cpf,
        senha: dados.senha,
        ...(perfil === 'ADVOGADO' && { numeroOab: dados.numeroOab }),
      });
      setCriado(dados.email);
    } catch (err) {
      if (err instanceof ErroApi) {
        setErros(err.campos);
        setErro(err.message);
      } else setErro('Não foi possível criar a conta agora.');
    } finally {
      setEnviando(false);
    }
  }

  if (criado) {
    return (
      <LayoutAcesso etiqueta="REQ01 · D1 · Apêndice A" estreito>
        <MailCheck size={44} color="var(--verde)" />
        <h1 style={{ marginTop: 16 }}>Confirme seu e-mail</h1>
        <p className="subtitulo">
          Enviamos um link de confirmação para <strong>{criado}</strong>. Abra o e-mail e clique no link para ativar sua conta.
        </p>
        <Link to="/entrar" className="botao primario largo">Ir para o login</Link>
      </LayoutAcesso>
    );
  }

  return (
    <LayoutAcesso etiqueta="REQ01 · D1 · Apêndice A">
      <h1>Criar conta</h1>
      <p className="subtitulo">Os dados são usados para identificar o responsável por cada registro.</p>
      {erro && <div className="alerta erro" role="alert">{erro}</div>}
      <form onSubmit={enviar}>
        <div className="campo">
          <label>Tipo de conta *</label>
          <div className="opcoes-perfil">
            {(['ADVOGADO', 'COMUM'] as const).map((p) => (
              <button type="button" key={p} className={`opcao${perfil === p ? ' ativa' : ''}`} onClick={() => setPerfil(p)}>
                <span className="radio" /> {p === 'ADVOGADO' ? 'Advogado' : 'Usuário comum'}
              </button>
            ))}
            <button type="button" className="opcao" disabled><span className="radio" /> Empresa · em breve</button>
          </div>
        </div>
        <Campo rotulo="Nome completo" name="nome" required autoComplete="name" value={dados.nome} onChange={alterar('nome')} erro={erros.nome} />
        <Campo rotulo="E-mail" name="email" type="email" required autoComplete="email" icone={<Mail size={18} />} value={dados.email} onChange={alterar('email')} erro={erros.email} />
        <div className={perfil === 'ADVOGADO' ? 'linha-2' : ''}>
          <Campo rotulo="CPF" name="cpf" required inputMode="numeric" placeholder="000.000.000-00" value={dados.cpf} onChange={alterar('cpf')} erro={erros.cpf} />
          {perfil === 'ADVOGADO' && (
            <Campo rotulo="Número da OAB" name="numeroOab" required placeholder="BA 12.345" value={dados.numeroOab} onChange={alterar('numeroOab')} erro={erros.numeroOab} dica="Exibido apenas para advogados" />
          )}
        </div>
        <div className="linha-2">
          <Campo rotulo="Senha" name="senha" type="password" required autoComplete="new-password" icone={<Lock size={18} />} value={dados.senha} onChange={alterar('senha')} erro={erros.senha} dica="Mínimo de 10 caracteres, com letras e números" />
          <Campo rotulo="Confirmar senha" name="confirmacao" type="password" required autoComplete="new-password" icone={<Lock size={18} />} value={dados.confirmacao} onChange={alterar('confirmacao')} erro={erros.confirmacao} />
        </div>
        <label className="aceite">
          <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} required />
          Li e aceito os Termos de Uso e a Política de Privacidade (LGPD).
        </label>
        <button className="botao primario largo" disabled={enviando || !aceite}>{enviando ? 'Criando…' : 'Criar conta'}</button>
      </form>
      <p style={{ textAlign: 'center', marginTop: 20 }}><Link to="/entrar">Já tem conta? Entrar</Link></p>
    </LayoutAcesso>
  );
}

/** Página aberta pelo link do e-mail de confirmação (ADR-0005: verificação de e-mail). */
export function VerificarEmail() {
  const [params] = useSearchParams();
  const [estado, setEstado] = useState<'verificando' | 'ok' | 'erro'>('verificando');
  const [mensagem, setMensagem] = useState('');

  useEffect(() => {
    api
      .publico('POST', '/api/auth/verificar-email', { token: params.get('token') ?? '' })
      .then(() => setEstado('ok'))
      .catch((e) => {
        setEstado('erro');
        setMensagem(e instanceof ErroApi ? e.message : 'Não foi possível confirmar o e-mail.');
      });
  }, [params]);

  return (
    <LayoutAcesso etiqueta="REQ01 · Segurança" estreito>
      {estado === 'verificando' && <p>Confirmando seu e-mail…</p>}
      {estado === 'ok' && (
        <>
          <MailCheck size={44} color="var(--verde)" />
          <h1 style={{ marginTop: 16 }}>E-mail confirmado</h1>
          <p className="subtitulo">Sua conta está ativa. Você recebeu créditos de boas-vindas para fazer seus primeiros registros.</p>
          <Link to="/entrar" className="botao primario largo">Entrar</Link>
        </>
      )}
      {estado === 'erro' && (
        <>
          <h1>Link inválido</h1>
          <div className="alerta erro">{mensagem}</div>
          <Link to="/entrar" className="botao secundario largo">Voltar ao login</Link>
        </>
      )}
    </LayoutAcesso>
  );
}
