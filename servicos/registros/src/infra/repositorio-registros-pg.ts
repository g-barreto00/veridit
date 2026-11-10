import type { Pool, PoolClient } from 'pg';
import type { Envelope } from '@veridit/contratos';
import { OutboxPg } from '@veridit/mensageria';
import { transacao } from '@veridit/plataforma';
import type {
  ExecutorTransacao,
  RegistradorEventos,
  RepositorioRegistros,
  Relogio,
  Transacao,
} from '../dominio/portas';
import { Registro, type StatusRegistro } from '../dominio/registro';

export const cliente = (tx: Transacao) => tx as unknown as PoolClient;
export const comoTransacao = (c: PoolClient) => c as unknown as Transacao;

export class ExecutorTransacaoPg implements ExecutorTransacao {
  constructor(private readonly pool: Pool) {}
  executar<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
    return transacao(this.pool, (c) => fn(comoTransacao(c)));
  }
}

export class RegistradorEventosOutbox implements RegistradorEventos {
  private readonly outbox = new OutboxPg();
  registrar(tx: Transacao, evento: Envelope) {
    return this.outbox.adicionar(cliente(tx), evento);
  }
}

export class RelogioSistema implements Relogio {
  agora() {
    return new Date();
  }
}

export class RepositorioRegistrosPg implements RepositorioRegistros {
  constructor(private readonly pool: Pool) {}

  async inserir(tx: Transacao, r: Registro) {
    const e = r.estado;
    await cliente(tx).query(
      `INSERT INTO registros (id, usuario_id, titulo, url, tipo, status, prazo_em, inicio_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [e.id, e.usuarioId, e.titulo, e.url, e.tipo, e.status, e.prazoEm ?? null, e.inicioEm],
    );
    await this.gravarHistorico(tx, r);
  }

  async carregarParaAlterar(tx: Transacao, id: string) {
    const { rows } = await cliente(tx).query('SELECT * FROM registros WHERE id = $1 FOR UPDATE', [id]);
    const l = rows[0];
    if (!l) return undefined;
    return new Registro({
      id: l.id,
      usuarioId: l.usuario_id,
      titulo: l.titulo,
      url: l.url,
      tipo: l.tipo,
      status: l.status,
      motivoFalha: l.motivo_falha ?? undefined,
      sessaoId: l.sessao_id ?? undefined,
      workerId: l.worker_id ?? undefined,
      prazoEm: l.prazo_em ?? undefined,
      quantidadeImagens: l.quantidade_imagens ?? undefined,
      quantidadeVideos: l.quantidade_videos ?? undefined,
      hashManifesto: l.hash_manifesto ?? undefined,
      inicioEm: l.inicio_em,
      fimEm: l.fim_em ?? undefined,
    });
  }

  async salvar(tx: Transacao, r: Registro) {
    const e = r.estado;
    await cliente(tx).query(
      `UPDATE registros SET status = $2, motivo_falha = $3, sessao_id = $4, worker_id = $5, prazo_em = $6,
              quantidade_imagens = $7, quantidade_videos = $8, hash_manifesto = $9, fim_em = $10, atualizado_em = now()
        WHERE id = $1`,
      [
        e.id,
        e.status,
        e.motivoFalha ?? null,
        e.sessaoId ?? null,
        e.workerId ?? null,
        e.prazoEm ?? null,
        e.quantidadeImagens ?? null,
        e.quantidadeVideos ?? null,
        e.hashManifesto ?? null,
        e.fimEm ?? null,
      ],
    );
    await this.gravarHistorico(tx, r);
  }

  async bloquearUsuario(tx: Transacao, usuarioId: string) {
    await cliente(tx).query('SELECT pg_advisory_xact_lock(hashtext($1))', [usuarioId]);
  }

  async contarEmEstados(tx: Transacao, usuarioId: string, estados: StatusRegistro[]) {
    const { rows } = await cliente(tx).query(
      'SELECT count(*)::int AS n FROM registros WHERE usuario_id = $1 AND status = ANY($2)',
      [usuarioId, estados],
    );
    return rows[0].n as number;
  }

  async comPrazoVencido(agora: Date, limite: number) {
    const { rows } = await this.pool.query(
      'SELECT id FROM registros WHERE prazo_em IS NOT NULL AND prazo_em <= $1 ORDER BY prazo_em LIMIT $2',
      [agora, limite],
    );
    return rows.map((r) => r.id as string);
  }

  private async gravarHistorico(tx: Transacao, r: Registro) {
    for (const t of r.transicoes) {
      await cliente(tx).query(
        'INSERT INTO registros_historico (registro_id, de, para, motivo, em) VALUES ($1, $2, $3, $4, $5)',
        [r.id, t.de === t.para ? null : t.de, t.para, t.motivo ?? null, t.em],
      );
    }
  }
}
