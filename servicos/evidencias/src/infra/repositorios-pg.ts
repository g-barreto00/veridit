import type { Pool, PoolClient } from 'pg';
import type { Envelope } from '@veridit/contratos';
import { OutboxPg } from '@veridit/mensageria';
import { HASH_GENESIS, hashCustodia } from '../dominio/manifesto';
import type {
  EtapaCustodia,
  EvidenciaSelada,
  RegistradorEventos,
  RegistroCustodia,
  RepositorioEvidencias,
  Relogio,
  Transacao,
} from '../dominio/portas';

export const cliente = (tx: Transacao) => tx as unknown as PoolClient;
export const comoTransacao = (c: PoolClient) => c as unknown as Transacao;

export class RegistradorEventosOutbox implements RegistradorEventos {
  private readonly outbox = new OutboxPg();
  registrar(tx: Transacao, e: Envelope) {
    return this.outbox.adicionar(cliente(tx), e);
  }
}

export class RelogioSistema implements Relogio {
  agora() {
    return new Date();
  }
}

export class RepositorioEvidenciasPg implements RepositorioEvidencias {
  constructor(private readonly pool: Pool) {}

  async existe(tx: Transacao, registroId: string) {
    return (await cliente(tx).query('SELECT 1 FROM evidencias WHERE registro_id = $1', [registroId])).rowCount! > 0;
  }

  async salvar(tx: Transacao, e: EvidenciaSelada) {
    const c = cliente(tx);
    await c.query(
      `INSERT INTO evidencias (registro_id, usuario_id, url_inicial, inicio_captura, fim_captura, hash_manifesto,
         assinatura, chave_assinatura, algoritmo_assinatura, carimbo_horario, carimbo_tsa, prefixo_worm,
         versoes_worm, quantidade_imagens, quantidade_videos, selada_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        e.registroId, e.usuarioId, e.urlInicial, e.inicioCaptura, e.fimCaptura, e.hashManifesto, e.assinatura,
        e.chaveAssinatura, e.algoritmoAssinatura, e.carimboHorario, e.carimboTsa, e.prefixoWorm,
        JSON.stringify(e.versoesWorm), e.quantidadeImagens, e.quantidadeVideos, e.seladaEm,
      ],
    );
    for (const a of e.arquivos) {
      await c.query(
        `INSERT INTO arquivos_evidencia (registro_id, nome, tipo, tamanho_bytes, sha256, capturado_em, url, chave_worm, versao_worm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [e.registroId, a.nome, a.tipo, a.tamanhoBytes, a.sha256, a.capturadoEm, a.url, a.chaveWorm, a.versaoWorm],
      );
    }
  }

  async buscar(registroId: string): Promise<EvidenciaSelada | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(registroId)) return undefined;
    const { rows } = await this.pool.query('SELECT * FROM evidencias WHERE registro_id = $1', [registroId]);
    const l = rows[0];
    if (!l) return undefined;
    const arquivos = await this.pool.query('SELECT * FROM arquivos_evidencia WHERE registro_id = $1 ORDER BY nome', [registroId]);
    return {
      registroId: l.registro_id,
      usuarioId: l.usuario_id,
      urlInicial: l.url_inicial,
      inicioCaptura: l.inicio_captura,
      fimCaptura: l.fim_captura,
      hashManifesto: l.hash_manifesto,
      assinatura: l.assinatura,
      chaveAssinatura: l.chave_assinatura,
      algoritmoAssinatura: l.algoritmo_assinatura,
      carimboHorario: l.carimbo_horario,
      carimboTsa: l.carimbo_tsa,
      prefixoWorm: l.prefixo_worm,
      versoesWorm: l.versoes_worm,
      quantidadeImagens: l.quantidade_imagens,
      quantidadeVideos: l.quantidade_videos,
      seladaEm: l.selada_em,
      arquivos: arquivos.rows.map((a) => ({
        nome: a.nome,
        tipo: a.tipo,
        tamanhoBytes: Number(a.tamanho_bytes),
        sha256: a.sha256,
        capturadoEm: a.capturado_em,
        url: a.url,
        chaveWorm: a.chave_worm,
        versaoWorm: a.versao_worm,
      })),
    };
  }
}

/** Cadeia de custódia com encadeamento de hashes (ADR-0004, passo 6). */
export class RegistroCustodiaPg implements RegistroCustodia {
  constructor(private readonly pool: Pool) {}

  async registrar(tx: Transacao, registroId: string, etapas: EtapaCustodia[]) {
    const c = cliente(tx);
    // Uma única cadeia: serializa quem acrescenta elos.
    await c.query("SELECT pg_advisory_xact_lock(hashtext('custodia'))");
    const { rows } = await c.query('SELECT hash FROM custodia ORDER BY id DESC LIMIT 1');
    let anterior: string = rows[0]?.hash ?? HASH_GENESIS;
    for (const e of etapas) {
      const hash = hashCustodia(anterior, registroId, e.etapa, e.detalhes, e.em);
      await c.query(
        'INSERT INTO custodia (registro_id, etapa, detalhes, em, hash_anterior, hash) VALUES ($1,$2,$3,$4,$5,$6)',
        [registroId, e.etapa, JSON.stringify(e.detalhes), e.em, anterior, hash],
      );
      anterior = hash;
    }
  }

  async verificarCadeia() {
    const { rows } = await this.pool.query('SELECT id, registro_id, etapa, detalhes, em, hash_anterior, hash FROM custodia ORDER BY id');
    let anterior = HASH_GENESIS;
    for (const l of rows) {
      const esperado = hashCustodia(anterior, l.registro_id, l.etapa, l.detalhes, l.em);
      if (l.hash_anterior !== anterior || l.hash !== esperado) return { integra: false, entradas: rows.length, primeiraQuebra: Number(l.id) };
      anterior = l.hash;
    }
    return { integra: true, entradas: rows.length };
  }
}
