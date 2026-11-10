import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Coins, Loader2, Mail, ShieldCheck, X } from 'lucide-react';
import { api, type ItemRegistro } from '../api/cliente';
import { Status, dataHora } from '../componentes/comuns';
import { useSessao } from '../sessao';

interface Evidencia {
  hashManifesto: string;
  seladaEm: string;
  assinatura: { algoritmo: string };
  carimbo: { autoridade: string; horario: string };
  quantidadeImagens: number;
  quantidadeVideos: number;
  arquivos: { nome: string; tipo: string; tamanhoBytes: number; sha256: string; integro: boolean }[];
  verificacao: { valida: boolean; arquivosIntegros: boolean; manifestoIntegro: boolean; assinaturaValida: boolean; carimboConfere: boolean };
}

type EstadoEtapa = 'feita' | 'atual' | 'pendente' | 'falha';

function Etapa({ estado, nome, desc }: { estado: EstadoEtapa; nome: string; desc: ReactNode }) {
  return (
    <li className={`etapa ${estado}`}>
      <span className="marca">
        {estado === 'feita' && <Check size={20} />}
        {estado === 'atual' && <Loader2 size={20} className="girando" />}
        {estado === 'falha' && <X size={20} />}
      </span>
      <div>
        <div className="nome">{nome}</div>
        <div className="desc">{desc}</div>
      </div>
    </li>
  );
}

/** Tela 12 — Selando a evidência (REQ11; ADR-0004) e resultado do registro. */
export function AcompanharRegistro() {
  const { id = '' } = useParams();
  const { usuario, atualizarSaldo } = useSessao();
  const [registro, setRegistro] = useState<ItemRegistro & { historico?: { para: string; em: string }[] }>();
  const [evidencia, setEvidencia] = useState<Evidencia>();
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;
    async function acompanhar() {
      while (ativo) {
        const r = await api.requisitar('GET', `/api/registros/${id}`).catch(() => null);
        if (!ativo) return;
        if (!r) return setErro('Registro não encontrado.');
        setRegistro(r);
        if (r.status === 'CONCLUIDO') {
          atualizarSaldo();
          const ev = await api.requisitar<Evidencia>('GET', `/api/evidencias/${id}`).catch(() => undefined);
          if (ativo) setEvidencia(ev);
          return;
        }
        if (['FALHOU', 'CANCELADO', 'RECUSADO'].includes(r.status)) return atualizarSaldo();
        await new Promise((ok) => setTimeout(ok, 1500));
      }
    }
    void acompanhar();
    return () => {
      ativo = false;
    };
  }, [id, atualizarSaldo]);

  if (erro) return <main className="pagina"><div className="alerta erro">{erro}</div></main>;
  if (!registro) return <div className="carregando">Carregando…</div>;

  const s = registro.status;
  const concluido = s === 'CONCLUIDO';
  const falhou = ['FALHOU', 'CANCELADO', 'RECUSADO'].includes(s);
  const fimCaptura = registro.historico?.find((h) => h.para === 'SELANDO')?.em;
  const selando: EstadoEtapa = concluido ? 'feita' : falhou ? 'falha' : 'atual';
  const etapaSelagem = (feita: ReactNode, emAndamento: ReactNode) => (concluido ? feita : emAndamento);
  const titulo = concluido ? 'Evidência selada' : falhou ? 'Registro não concluído' : 'Selando sua evidência';

  return (
    <main className="pagina">
      <div className="trilha"><Link to="/registros">Meus registros</Link> / {registro.titulo}</div>
      <div className="pagina-topo">
        <div>
          <h1>{titulo}</h1>
          <p className="subtitulo">
            {concluido
              ? 'Os arquivos foram protegidos com hash, assinatura digital e carimbo do tempo.'
              : falhou
                ? registro.motivoFalha ?? 'O registro foi encerrado.'
                : 'A captura foi concluída. Estamos protegendo os arquivos antes de liberar o download.'}
          </p>
        </div>
        <span className="etiqueta-req">REQ11 · ADR-0004</span>
      </div>

      <div className="grade-lateral">
        <section className="cartao">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -24 }}><Status status={s} /></div>
          <ol className="etapas">
            <Etapa
              estado={fimCaptura ? 'feita' : falhou ? 'falha' : 'pendente'}
              nome="Captura concluída"
              desc={fimCaptura ? `${registro.quantidadeImagens ?? evidencia?.quantidadeImagens ?? ''} ${concluido ? 'imagens · ' : ''}${dataHora(fimCaptura)}` : 'Não concluída'}
            />
            <Etapa
              estado={fimCaptura ? selando : 'pendente'}
              nome="Hashes calculados (SHA-256)"
              desc={etapaSelagem(`${evidencia?.arquivos.length ?? ''} arquivos verificados`, 'Calculando…')}
            />
            <Etapa
              estado={fimCaptura ? (concluido ? 'feita' : falhou ? 'falha' : 'pendente') : 'pendente'}
              nome="Manifesto assinado"
              desc={etapaSelagem(`Assinatura digital da plataforma (${evidencia?.assinatura.algoritmo ?? 'ECDSA'})`, 'Assinatura digital da plataforma')}
            />
            <Etapa
              estado={fimCaptura ? (concluido ? 'feita' : falhou ? 'falha' : 'pendente') : 'pendente'}
              nome="Carimbo do tempo"
              desc={etapaSelagem(
                evidencia ? `${evidencia.carimbo.autoridade} · ${new Date(evidencia.carimbo.horario).toLocaleString('pt-BR')}` : '',
                'Solicitando à Autoridade de Carimbo do Tempo…',
              )}
            />
            <Etapa estado="pendente" nome="Relatório e pacote .zip" desc="Disponível na próxima versão (REQ14, REQ15)" />
          </ol>
        </section>

        <div className="cartoes-laterais">
          {concluido && evidencia && (
            <div className="cartao">
              <h3><ShieldCheck size={20} color={evidencia.verificacao.valida ? 'var(--verde)' : 'var(--vermelho)'} /> Verificação</h3>
              <p>
                {evidencia.verificacao.valida
                  ? 'Hashes, assinatura e carimbo conferidos agora a partir do armazenamento imutável.'
                  : 'A verificação encontrou divergências.'}
              </p>
              <p className="mono">SHA-256 do manifesto:<br />{evidencia.hashManifesto}</p>
            </div>
          )}
          {!falhou && (
            <div className="cartao">
              <h3><Mail size={20} /> E-mail de conclusão</h3>
              <p>O aviso por e-mail em {usuario?.email} (REQ10/REQ11-B) chega na próxima versão.</p>
              <Link to="/registros" className="botao secundario">Ver meus registros</Link>
            </div>
          )}
          <div className="cartao">
            <h3><Coins size={20} color="var(--laranja)" /> Créditos</h3>
            <p>
              {concluido
                ? '1 crédito consumido na conclusão do registro.'
                : falhou
                  ? 'A reserva de créditos foi devolvida para o seu saldo.'
                  : '1 crédito reservado. Ele será consumido quando a selagem terminar; se algo falhar, volta para o seu saldo.'}
            </p>
            {falhou && <Link to="/registros/novo" className="botao secundario">Novo registro</Link>}
          </div>
        </div>
      </div>
    </main>
  );
}
