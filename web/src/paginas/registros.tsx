import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Camera, Globe, Plus, Search, ShieldCheck, Video } from 'lucide-react';
import { ErroApi, api, type ListaRegistros } from '../api/cliente';
import { Campo, Status, dataHora } from '../componentes/comuns';
import { useSessao } from '../sessao';

const EM_ANDAMENTO = ['INICIADO', 'CREDITOS_RESERVADOS', 'AGUARDANDO_SESSAO', 'EM_CAPTURA'];

/** Tela 05 — Meus registros (REQ12; REQ04 no cabeçalho). */
export function MeusRegistros() {
  const { saldo } = useSessao();
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('');
  const [periodo, setPeriodo] = useState('30');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<ListaRegistros | null>(null);
  const [erro, setErro] = useState('');
  const [atualizacao, setAtualizacao] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams({ pagina: String(pagina), tamanho: '10' });
      if (busca.trim()) q.set('busca', busca.trim());
      if (status) q.set('status', status);
      if (periodo) q.set('periodoDias', periodo);
      api
        .requisitar<ListaRegistros>('GET', `/api/registros?${q}`)
        .then((d) => {
          setDados(d);
          setErro('');
        })
        .catch((e) => setErro(e instanceof ErroApi ? e.message : 'Não foi possível carregar os registros.'));
    }, 250);
    return () => clearTimeout(t);
  }, [busca, status, periodo, pagina, atualizacao]);

  // Atualiza sozinho enquanto houver registro em andamento.
  const temAndamento = dados?.itens.some((i) => [...EM_ANDAMENTO, 'SELANDO'].includes(i.status));
  useEffect(() => {
    if (!temAndamento) return;
    const t = setInterval(() => setAtualizacao((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, [temAndamento]);

  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.tamanho)) : 1;

  return (
    <main className="pagina">
      <div className="pagina-topo">
        <div>
          <h1>Meus registros</h1>
          <p className="subtitulo" style={{ margin: 0 }}>Acompanhe o status e acesse os detalhes dos seus registros.</p>
        </div>
        <div className="acoes">
          <span className="etiqueta-req">REQ12 · REQ04</span>
          <Link to="/registros/novo" className="botao destaque"><Plus size={18} /> Novo registro</Link>
        </div>
      </div>

      <div className="indicadores">
        <div className="cartao indicador">
          <div className="rotulo">Registros concluídos</div>
          <div className="valor" style={{ color: 'var(--verde)' }}>{dados?.contadores.concluidos ?? '–'}</div>
        </div>
        <div className="cartao indicador">
          <div className="rotulo">Em andamento</div>
          <div className="valor" style={{ color: 'var(--azul)' }}>{dados?.contadores.emAndamento ?? '–'}</div>
        </div>
        <div className="cartao indicador">
          <div className="rotulo">Créditos disponíveis</div>
          <div className="valor" style={{ color: 'var(--laranja)' }}>{saldo?.disponivel ?? '–'}</div>
        </div>
      </div>

      <div className="filtros">
        <Campo rotulo="Buscar" name="busca" placeholder="Buscar por título" icone={<Search size={18} />} value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
        <div className="campo">
          <label htmlFor="status">Status</label>
          <select id="status" value={status} onChange={(e) => { setStatus(e.target.value); setPagina(1); }}>
            <option value="">Todos</option>
            <option value="concluido">Concluídos</option>
            <option value="andamento">Em andamento</option>
            <option value="falhou">Falhou / recusado</option>
            <option value="cancelado">Cancelados</option>
          </select>
        </div>
        <div className="campo">
          <label htmlFor="periodo">Período</label>
          <select id="periodo" value={periodo} onChange={(e) => { setPeriodo(e.target.value); setPagina(1); }}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="">Todo o período</option>
          </select>
        </div>
      </div>

      {erro && <div className="alerta erro">{erro}</div>}

      <div className="cartao tabela-cartao">
        <table className="tabela">
          <thead>
            <tr><th>Título</th><th>Início</th><th>Fim</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {dados?.itens.map((r) => (
              <tr key={r.id}>
                <td className="titulo">{r.titulo}</td>
                <td className="data">{dataHora(r.inicio)}</td>
                <td className="data">{dataHora(r.fim)}</td>
                <td><Status status={r.status} /></td>
                <td style={{ textAlign: 'right' }}>
                  <Link
                    to={EM_ANDAMENTO.includes(r.status) ? `/registros/${r.id}/sessao` : `/registros/${r.id}`}
                    style={{ color: 'var(--marinho)', display: 'inline-flex', gap: 6, alignItems: 'center' }}
                  >
                    {EM_ANDAMENTO.includes(r.status) ? 'Abrir sessão' : 'Ver detalhes'} <ArrowRight size={16} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {dados && dados.itens.length === 0 && (
          <div className="vazio">Nenhum registro encontrado. <Link to="/registros/novo">Fazer o primeiro registro</Link></div>
        )}
      </div>

      <div className="rodape-tabela">
        <span>{dados ? `Mostrando ${dados.itens.length} de ${dados.total} registros` : ''}</span>
        <div className="paginacao">
          <button disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
          <span>{pagina} / {totalPaginas}</span>
          <button disabled={pagina >= totalPaginas} onClick={() => setPagina(pagina + 1)}>Próxima</button>
        </div>
      </div>
      <p style={{ color: 'var(--suave)', fontSize: 13, fontStyle: 'italic' }}>Falhou: créditos reservados devolvidos automaticamente.</p>
    </main>
  );
}

/** Tela 10 — Novo registro (REQ08; Apêndice A: endereço do site e título). */
export function NovoRegistro() {
  const { saldo, atualizarSaldo } = useSessao();
  const navegar = useNavigate();
  const [url, setUrl] = useState('');
  const [titulo, setTitulo] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const custo = 1;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setErros({});
    setEnviando(true);
    try {
      const r = await api.requisitar<{ id: string }>('POST', '/api/registros', { url, titulo, tipo: 'TELA' });
      atualizarSaldo();
      navegar(`/registros/${r.id}/sessao`);
    } catch (err) {
      if (err instanceof ErroApi) {
        setErros(err.campos);
        setErro(err.message);
      } else setErro('Não foi possível iniciar o registro.');
      setEnviando(false);
    }
  }

  return (
    <main className="pagina">
      <div className="pagina-topo">
        <div>
          <h1>Novo registro</h1>
          <p className="subtitulo">Informe o site e escolha o que será registrado.</p>
        </div>
        <span className="etiqueta-req">REQ08 · Apêndice A</span>
      </div>
      <div className="grade-lateral">
        <form className="cartao" onSubmit={enviar}>
          {erro && <div className="alerta erro" role="alert">{erro}</div>}
          <Campo rotulo="Endereço do site" name="url" required placeholder="https://www.exemplo.com.br/publicacao/12345" icone={<Globe size={18} />} value={url} onChange={(e) => setUrl(e.target.value)} erro={erros.url} />
          <Campo rotulo="Título do registro" name="titulo" required placeholder="Publicação em rede social · perfil público" value={titulo} onChange={(e) => setTitulo(e.target.value)} erro={erros.titulo} dica="Usado no relatório e na listagem." />
          <div className="campo"><label>O que você quer registrar? *</label></div>
          <div className="tipos">
            <button type="button" className="tipo ativo">
              <div className="tipo-topo"><span className="tipo-icone"><Camera size={20} /></span>Captura de tela</div>
              <p>Imagens da página no estado atual. Você pode capturar várias telas.</p>
              <span className="custo">1 crédito</span>
            </button>
            <button type="button" className="tipo" disabled title="Vídeo de navegação (REQ09): próxima versão">
              <div className="tipo-topo"><span className="tipo-icone"><Video size={20} /></span>Vídeo de navegação</div>
              <p>Grava a sua navegação pelo site, com cliques e rolagem.</p>
              <span className="custo" style={{ color: 'var(--suave)' }}>Disponível na próxima versão</span>
            </button>
          </div>
          <div className="explicacao">
            <ShieldCheck size={22} color="var(--marinho)" style={{ flex: 'none' }} />
            <div>
              <strong>Como a captura funciona</strong>
              <p>A navegação acontece em um navegador seguro do Veridit, isolado no servidor. Assim conseguimos comprovar de onde e quando o conteúdo foi obtido. Ao concluir, os arquivos recebem hash, assinatura digital e carimbo do tempo.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            <button className="botao destaque" disabled={enviando} style={{ minWidth: 260 }}>
              <ArrowRight size={18} /> {enviando ? 'Iniciando…' : 'Iniciar registro'}
            </button>
            <Link to="/registros" style={{ color: 'var(--marinho)' }}>Cancelar</Link>
          </div>
        </form>
        <aside className="cartao">
          <h2>Créditos</h2>
          <div className="resumo-linha"><span>Saldo disponível</span><strong>{saldo?.disponivel ?? '–'}</strong></div>
          <div className="resumo-linha"><span>Reserva para este registro</span><strong style={{ color: 'var(--laranja)' }}>− {custo}</strong></div>
          <div className="resumo-linha"><span>Saldo após reserva</span><strong>{saldo ? saldo.disponivel - custo : '–'}</strong></div>
          <p className="nota">Os créditos só são consumidos quando o registro é concluído. Se a captura falhar, a reserva volta para o seu saldo.</p>
        </aside>
      </div>
    </main>
  );
}
