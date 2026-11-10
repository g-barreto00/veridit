import type { InputHTMLAttributes, ReactNode } from 'react';
import { Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Archive, Coins, Globe, Hash, LogOut, Stamp } from 'lucide-react';
import type { StatusRegistro } from '../api/cliente';
import { useSessao } from '../sessao';

export function Logo({ claro = false }: { claro?: boolean }) {
  return (
    <span className="logo" style={{ color: claro ? '#fff' : 'var(--marinho)' }}>
      <span className="selo">
        <Stamp size={18} />
      </span>
      Veridit
    </span>
  );
}

/** Rótulo e cor de cada estado da saga (diagrama c11-estados) na interface. */
const STATUS: Record<StatusRegistro, [string, string]> = {
  INICIADO: ['Iniciando', 'andamento'],
  CREDITOS_RESERVADOS: ['Iniciando', 'andamento'],
  AGUARDANDO_SESSAO: ['Aguardando sessão', 'andamento'],
  EM_CAPTURA: ['Em captura', 'andamento'],
  SELANDO: ['Selando', 'andamento'],
  CONCLUIDO: ['Concluído', 'concluido'],
  RECUSADO: ['Recusado', 'falhou'],
  FALHOU: ['Falhou', 'falhou'],
  CANCELADO: ['Cancelado', 'cancelado'],
};

export function Status({ status }: { status: StatusRegistro }) {
  const [rotulo, classe] = STATUS[status] ?? [status, 'cancelado'];
  return <span className={`status ${classe}`}>{rotulo}</span>;
}

export const dataHora = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

interface PropsCampo extends InputHTMLAttributes<HTMLInputElement> {
  rotulo: string;
  erro?: string;
  dica?: string;
  icone?: ReactNode;
}

export function Campo({ rotulo, erro, dica, icone, ...input }: PropsCampo) {
  return (
    <div className={`campo${erro ? ' erro' : ''}`}>
      <label htmlFor={input.id ?? input.name}>
        {rotulo}
        {input.required && ' *'}
      </label>
      <div style={{ position: 'relative' }}>
        {icone && <span style={{ position: 'absolute', left: 14, top: 13, color: 'var(--suave)' }}>{icone}</span>}
        <input id={input.id ?? input.name} {...input} style={{ width: '100%', paddingLeft: icone ? 42 : 14, ...input.style }} />
      </div>
      {erro ? <span className="msg-erro">{erro}</span> : dica && <span className="dica">{dica}</span>}
    </div>
  );
}

/** Layout das telas de acesso (01 Entrar, 02 Criar conta). */
export function LayoutAcesso({ etiqueta, estreito, children }: { etiqueta: string; estreito?: boolean; children: ReactNode }) {
  return (
    <div className="acesso">
      <aside className="acesso-lateral">
        <Logo claro />
        <div className="chamada">
          <h2>Registre conteúdo da web com valor de prova.</h2>
          <p>Capture telas e vídeos de navegação em um ambiente controlado e receba um pacote verificável.</p>
          <ul>
            <li><span className="icone"><Globe size={18} /></span>Captura em navegador isolado no servidor</li>
            <li><span className="icone"><Hash size={18} /></span>Hash SHA-256, assinatura e carimbo do tempo</li>
            <li><span className="icone"><Archive size={18} /></span>Relatório e pacote .zip verificáveis</li>
          </ul>
        </div>
        <footer>Veridit · Engenharia de Software I · UFBA</footer>
      </aside>
      <main className="acesso-conteudo">
        <div className="topo"><span className="etiqueta-req">{etiqueta}</span></div>
        <div className={`acesso-form${estreito ? ' estreito' : ''}`}>{children}</div>
      </main>
    </div>
  );
}

/** Cabeçalho das telas logadas (telas 05, 10, 12). */
export function Cabecalho() {
  const { usuario, saldo, sair } = useSessao();
  const navegar = useNavigate();
  if (!usuario) return null;
  const iniciais = usuario.nome.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const perfil =
    usuario.perfil === 'ADVOGADO'
      ? `Advogado(a)${usuario.numeroOab ? ` · OAB/${usuario.numeroOab.split(' ')[0]}` : ''}`
      : 'Usuário comum';

  return (
    <header className="cabecalho">
      <Link to="/registros"><Logo /></Link>
      <nav>
        <NavLink to="/registros" end>Meus registros</NavLink>
        <NavLink to="/registros/novo">Novo registro</NavLink>
        <a className="inativo" title="Compra de créditos (REQ05/REQ06): próxima versão">Comprar créditos</a>
      </nav>
      <div className="direita">
        <span className="creditos" title="Créditos disponíveis">
          <Coins size={16} /> {saldo ? `${saldo.disponivel} ${saldo.disponivel === 1 ? 'crédito' : 'créditos'}` : '…'}
        </span>
        <div className="usuario">
          <span className="avatar">{iniciais}</span>
          <div>
            <div className="nome">{usuario.nome}</div>
            <div className="perfil">{perfil}</div>
          </div>
        </div>
        {/* REQ04 — Sair do sistema */}
        <button className="sair" onClick={() => void sair().then(() => navegar('/entrar'))}>
          <LogOut size={16} /> Sair
        </button>
      </div>
    </header>
  );
}

/** Só usuários autenticados (ADR-0001: acesso apenas por usuários cadastrados). */
export function RotaPrivada({ children, semCabecalho }: { children: ReactNode; semCabecalho?: boolean }) {
  const { usuario, carregando } = useSessao();
  const local = useLocation();
  if (carregando) return <div className="carregando">Carregando…</div>;
  if (!usuario) return <Navigate to="/entrar" replace state={{ de: local.pathname }} />;
  return (
    <>
      {!semCabecalho && <Cabecalho />}
      {children}
    </>
  );
}
