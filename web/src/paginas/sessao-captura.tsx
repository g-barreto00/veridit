import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Camera, Check, Loader2, Lock, RotateCw } from 'lucide-react';
import { api, type ItemRegistro } from '../api/cliente';
import { Logo } from '../componentes/comuns';

interface Captura {
  numero: number;
  nomeArquivo: string;
  url: string;
  hora: string;
  miniatura: string;
  metadados?: {
    ip?: string;
    dns?: { hostname: string; enderecos: string[] };
    tls?: { emissor?: string; sujeito?: string; validoAte?: string; protocolo?: string };
    horario?: string;
    fonteHorario?: string;
  };
}

const LARGURA = 1280;
const ALTURA = 720;
const AGUARDANDO = ['INICIADO', 'CREDITOS_RESERVADOS', 'AGUARDANDO_SESSAO'];

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * Tela 11 — Sessão de captura (REQ08, REQ11; ADR-0003). O navegador roda isolado no servidor;
 * esta tela só mostra os quadros da tela remota e envia mouse, teclado e comandos.
 */
export function SessaoCaptura() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const canvas = useRef<HTMLCanvasElement>(null);
  const ws = useRef<WebSocket | null>(null);
  const ultimoMovimento = useRef(0);
  const [registro, setRegistro] = useState<ItemRegistro | null>(null);
  const [fase, setFase] = useState<'aguardando' | 'conectando' | 'ativa' | 'desconectada' | 'encerrada'>('aguardando');
  const [url, setUrl] = useState('');
  const [editandoUrl, setEditandoUrl] = useState(false);
  const [restante, setRestante] = useState<number | null>(null);
  const [capturas, setCapturas] = useState<Captura[]>([]);
  const [capturando, setCapturando] = useState(false);
  const [concluindo, setConcluindo] = useState(false);
  const [aviso, setAviso] = useState('');
  const [mensagemFim, setMensagemFim] = useState('');

  const enviar = useCallback((msg: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
  }, []);

  // 1) Espera o worker abrir o navegador isolado (AGUARDANDO_SESSAO → EM_CAPTURA).
  useEffect(() => {
    let ativo = true;
    async function acompanhar() {
      while (ativo) {
        const r = await api.requisitar<ItemRegistro>('GET', `/api/registros/${id}`).catch(() => null);
        if (!ativo) return;
        if (!r) return navegar('/registros');
        setRegistro(r);
        if (r.status === 'EM_CAPTURA') return setFase((f) => (f === 'aguardando' ? 'conectando' : f));
        if (!AGUARDANDO.includes(r.status)) return navegar(`/registros/${id}`, { replace: true });
        await new Promise((ok) => setTimeout(ok, 1000));
      }
    }
    void acompanhar();
    return () => {
      ativo = false;
    };
  }, [id, navegar]);

  // 2) Conecta ao WebSocket da sessão (pelo gateway, que confere token e dono do registro).
  const conectar = useCallback(async (tentouRenovar = false) => {
    if (!api.token) await api.renovar();
    const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocolo}://${location.host}/api/sessoes/${id}/ws?token=${encodeURIComponent(api.token ?? '')}`);
    ws.current = socket;
    let abriu = false;

    socket.onopen = () => {
      abriu = true;
      setFase('ativa');
    };
    socket.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      switch (m.tipo) {
        case 'quadro': {
          const img = new Image();
          img.onload = () => canvas.current?.getContext('2d')?.drawImage(img, 0, 0, LARGURA, ALTURA);
          img.src = `data:image/jpeg;base64,${m.imagem}`;
          break;
        }
        case 'pronta':
        case 'navegacao':
          if (m.url) setUrl(m.url);
          break;
        case 'tempo':
          setRestante(m.restanteSegundos);
          break;
        case 'captura':
          setCapturando(false);
          setCapturas((cs) => [
            ...cs,
            {
              numero: m.numero,
              nomeArquivo: m.nomeArquivo,
              url: m.url,
              hora: new Date().toLocaleTimeString('pt-BR'),
              miniatura: canvas.current?.toDataURL('image/jpeg', 0.4) ?? '',
              metadados: m.metadados,
            },
          ]);
          break;
        case 'erro':
          setCapturando(false);
          setConcluindo(false);
          setAviso(m.mensagem);
          break;
        case 'encerrada':
          setFase('encerrada');
          if (m.resultado === 'concluida') navegar(`/registros/${id}`, { replace: true });
          else setMensagemFim(m.mensagem);
          break;
      }
    };
    socket.onclose = () => {
      if (!abriu && !tentouRenovar) {
        // Token pode ter expirado: renova e tenta uma vez.
        void api.renovar().then(() => conectar(true));
        return;
      }
      setFase((f) => (f === 'encerrada' ? f : 'desconectada'));
    };
  }, [id, navegar]);

  useEffect(() => {
    if (fase === 'conectando') void conectar();
  }, [fase, conectar]);

  useEffect(() => () => ws.current?.close(), []);

  // 3) Entrada do usuário → navegador remoto.
  const ponto = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * LARGURA),
      y: Math.round(((e.clientY - r.top) / r.height) * ALTURA),
    };
  };
  const botao = (b: number) => (b === 2 ? 'right' : b === 1 ? 'middle' : 'left');

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const rolar = (e: WheelEvent) => {
      e.preventDefault();
      enviar({ tipo: 'rolar', ...ponto(e), deltaX: Math.round(e.deltaX), deltaY: Math.round(e.deltaY) });
    };
    c.addEventListener('wheel', rolar, { passive: false });
    return () => c.removeEventListener('wheel', rolar);
  }, [enviar, fase]);

  const capturar = () => {
    setAviso('');
    setCapturando(true);
    enviar({ tipo: 'capturar' });
  };
  const concluir = () => {
    setAviso('');
    setConcluindo(true);
    enviar({ tipo: 'concluir' });
  };
  const cancelar = async () => {
    if (!confirm('Cancelar este registro? A reserva de créditos volta para o seu saldo.')) return;
    enviar({ tipo: 'cancelar' });
    await api.requisitar('POST', `/api/registros/${id}/cancelar`).catch(() => undefined);
    navegar('/registros');
  };
  const irPara = (e: FormEvent) => {
    e.preventDefault();
    setEditandoUrl(false);
    enviar({ tipo: 'navegar', url });
    canvas.current?.focus();
  };

  const meta = capturas.at(-1)?.metadados;
  const ativa = fase === 'ativa';

  return (
    <div className="sessao">
      <header className="sessao-topo">
        <Logo claro />
        <div className="info">
          <div className="titulo">{registro?.titulo ?? 'Registro'}</div>
          <div className="sub">
            Registro #{id.slice(0, 8).toUpperCase()} · sessão isolada{restante !== null && ` · expira em ${Math.ceil(restante / 60)} min`}
          </div>
        </div>
        {ativa && restante !== null && (
          <span className="relogio"><span className="ponto-vivo" /> Sessão ativa {mmss(restante)}</span>
        )}
        <button className="botao secundario" onClick={capturar} disabled={!ativa || capturando}>
          {capturando ? <Loader2 size={18} className="girando" /> : <Camera size={18} />} Capturar tela
        </button>
        <button className="botao destaque" onClick={concluir} disabled={!ativa || concluindo || capturas.length === 0} title={capturas.length === 0 ? 'Faça ao menos uma captura de tela' : ''}>
          {concluindo ? <Loader2 size={18} className="girando" /> : <Check size={18} />} Concluir registro
        </button>
        <button className="botao secundario" onClick={() => void cancelar()} disabled={fase === 'encerrada'}>Cancelar</button>
      </header>

      <div className="sessao-corpo">
        <section className="janela">
          <div className="janela-barra">
            <span className="semaforo"><i style={{ background: '#ef4444' }} /><i style={{ background: '#f59e0b' }} /><i style={{ background: '#10b981' }} /></span>
            <button title="Voltar" onClick={() => enviar({ tipo: 'voltar' })} disabled={!ativa}><ArrowLeft size={18} /></button>
            <button title="Avançar" onClick={() => enviar({ tipo: 'avancar' })} disabled={!ativa}><ArrowRight size={18} /></button>
            <button title="Recarregar" onClick={() => enviar({ tipo: 'recarregar' })} disabled={!ativa}><RotateCw size={16} /></button>
            <form onSubmit={irPara} style={{ position: 'relative' }}>
              <Lock size={14} color="var(--verde)" style={{ position: 'absolute', left: 14, top: 10 }} />
              <input
                className="endereco"
                style={{ paddingLeft: 34 }}
                value={url}
                disabled={!ativa}
                onFocus={() => setEditandoUrl(true)}
                onBlur={() => setEditandoUrl(false)}
                onChange={(e) => editandoUrl && setUrl(e.target.value)}
                aria-label="Endereço"
              />
            </form>
          </div>
          <div className="tela-remota">
            <canvas
              ref={canvas}
              width={LARGURA}
              height={ALTURA}
              tabIndex={0}
              onContextMenu={(e) => e.preventDefault()}
              onMouseMove={(e) => {
                const agora = performance.now();
                if (agora - ultimoMovimento.current < 40) return;
                ultimoMovimento.current = agora;
                enviar({ tipo: 'mouse', acao: 'move', ...ponto(e) });
              }}
              onMouseDown={(e) => {
                canvas.current?.focus();
                enviar({ tipo: 'mouse', acao: 'down', ...ponto(e), botao: botao(e.button) });
              }}
              onMouseUp={(e) => enviar({ tipo: 'mouse', acao: 'up', ...ponto(e), botao: botao(e.button) })}
              onKeyDown={(e) => {
                e.preventDefault();
                enviar({ tipo: 'tecla', acao: 'down', tecla: e.key });
              }}
              onKeyUp={(e) => {
                e.preventDefault();
                enviar({ tipo: 'tecla', acao: 'up', tecla: e.key });
              }}
            />
            {fase !== 'ativa' && (
              <div className="aviso">
                {fase === 'aguardando' && <><Loader2 className="girando" /><p>Preparando o navegador isolado no servidor…</p></>}
                {fase === 'conectando' && <><Loader2 className="girando" /><p>Conectando à sessão…</p></>}
                {fase === 'desconectada' && (
                  <>
                    <p>A conexão com a sessão caiu.</p>
                    <button className="botao secundario" onClick={() => setFase('conectando')}>Reconectar</button>
                  </>
                )}
                {fase === 'encerrada' && (
                  <>
                    <p>Sessão encerrada: {mensagemFim}</p>
                    <Link to="/registros" className="botao secundario">Voltar aos registros</Link>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="painel">
          <h2>Capturas desta sessão</h2>
          {aviso && <div className="alerta erro">{aviso}</div>}
          <div className="miniaturas">
            {capturas.length === 0 && <p style={{ color: 'var(--suave)', fontSize: 14, margin: 0 }}>Navegue até o conteúdo e clique em <strong>Capturar tela</strong>.</p>}
            {capturas.map((c) => (
              <div className="miniatura" key={c.numero}>
                <span className="quadro">{c.miniatura && <img src={c.miniatura} alt="" />}</span>
                <div>
                  <div className="nome">{c.nomeArquivo}</div>
                  <div className="hora">{c.hora}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="meta">
            <h2>Metadados coletados</h2>
            <dl>
              <div><dt>IP do servidor</dt><dd>{meta?.ip ?? '—'}</dd></div>
              <div><dt>DNS</dt><dd>{meta?.dns ? `${meta.dns.hostname} → ${meta.dns.enderecos[0] ?? '—'}` : '—'}</dd></div>
              <div>
                <dt>Certificado TLS</dt>
                <dd>{meta?.tls ? `${meta.tls.protocolo ?? ''} · emitido para ${meta.tls.sujeito} por ${meta.tls.emissor}` : capturas.length ? 'sem TLS (http)' : '—'}</dd>
              </div>
              <div>
                <dt>Horário ({meta?.fonteHorario?.startsWith('ntp') ? 'NTP' : 'sistema'})</dt>
                <dd>{meta?.horario ? new Date(meta.horario).toLocaleString('pt-BR') : '—'}</dd>
              </div>
              <div><dt>Navegador</dt><dd>Chromium isolado</dd></div>
            </dl>
            <p style={{ color: 'var(--suave)', fontSize: 13, marginTop: 24 }}>Concluir encerra a sessão e envia os arquivos para selagem.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
