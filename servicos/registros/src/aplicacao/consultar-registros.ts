import type { Pool } from 'pg';
import type { StatusRegistro } from '../dominio/registro';

/** Agrupamentos de status usados no filtro da tela "Meus registros" (tela 05). */
const GRUPOS: Record<string, StatusRegistro[]> = {
  concluido: ['CONCLUIDO'],
  andamento: ['INICIADO', 'CREDITOS_RESERVADOS', 'AGUARDANDO_SESSAO', 'EM_CAPTURA', 'SELANDO'],
  falhou: ['FALHOU', 'RECUSADO'],
  cancelado: ['CANCELADO'],
};

export interface FiltroRegistros {
  busca?: string;
  status?: string;
  periodoDias?: number;
  pagina?: number;
  tamanho?: number;
}

const COLUNAS = `id, titulo, url, tipo, status, motivo_falha AS "motivoFalha",
  inicio_em AS "inicio", fim_em AS "fim", quantidade_imagens AS "quantidadeImagens",
  quantidade_videos AS "quantidadeVideos"`;

/**
 * REQ12 — Listar registros realizados (título, início, fim, detalhes, status — Apêndice A).
 * Consulta só leitura, sempre filtrada pelo dono (cada usuário só vê os próprios registros).
 */
export class ConsultarRegistros {
  constructor(private readonly pool: Pool) {}

  async listar(usuarioId: string, f: FiltroRegistros) {
    const tamanho = Math.min(Math.max(f.tamanho ?? 10, 1), 50);
    const pagina = Math.max(f.pagina ?? 1, 1);
    const condicoes = ['usuario_id = $1'];
    const params: unknown[] = [usuarioId];

    if (f.busca?.trim()) {
      params.push(`%${f.busca.trim().replace(/[%_\\]/g, '\\$&')}%`);
      condicoes.push(`titulo ILIKE $${params.length}`);
    }
    if (f.status && GRUPOS[f.status]) {
      params.push(GRUPOS[f.status]);
      condicoes.push(`status = ANY($${params.length})`);
    }
    if (f.periodoDias && f.periodoDias > 0) {
      params.push(f.periodoDias);
      condicoes.push(`inicio_em >= now() - make_interval(days => $${params.length})`);
    }
    const onde = condicoes.join(' AND ');

    const [itens, total, contadores] = await Promise.all([
      this.pool.query(
        `SELECT ${COLUNAS} FROM registros WHERE ${onde} ORDER BY inicio_em DESC LIMIT ${tamanho} OFFSET ${(pagina - 1) * tamanho}`,
        params,
      ),
      this.pool.query(`SELECT count(*)::int AS total FROM registros WHERE ${onde}`, params),
      this.pool.query(
        `SELECT count(*) FILTER (WHERE status = 'CONCLUIDO')::int AS concluidos,
                count(*) FILTER (WHERE status = ANY($2))::int AS "emAndamento"
           FROM registros WHERE usuario_id = $1`,
        [usuarioId, GRUPOS.andamento],
      ),
    ]);

    return {
      itens: itens.rows,
      total: total.rows[0].total,
      pagina,
      tamanho,
      contadores: contadores.rows[0],
    };
  }

  async detalhar(usuarioId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const { rows } = await this.pool.query(
      `SELECT ${COLUNAS}, sessao_id AS "sessaoId", hash_manifesto AS "hashManifesto", prazo_em AS "prazo"
         FROM registros WHERE id = $1 AND usuario_id = $2`,
      [id, usuarioId],
    );
    if (!rows[0]) return undefined;
    const historico = await this.pool.query(
      'SELECT de, para, motivo, em FROM registros_historico WHERE registro_id = $1 ORDER BY id',
      [id],
    );
    return { ...rows[0], historico: historico.rows };
  }
}
