import type { Pool, PoolClient } from 'pg';
import { transacao } from '@veridit/plataforma';
import { Carteira, type TipoLancamento } from '../dominio/carteira';
import {
  ConflitoConcorrencia,
  type ConsultaInvariantes,
  type ExecutorTransacao,
  type PoliticaConsumo,
  type RepositorioCarteiras,
  type RepositorioReservas,
  type Relogio,
  type Reserva,
  type Transacao,
} from '../dominio/portas';

const cliente = (tx: Transacao) => tx as unknown as PoolClient;
const VIOLACAO_UNICIDADE = '23505';

export class ExecutorTransacaoPg implements ExecutorTransacao {
  constructor(private readonly pool: Pool) {}
  async executar<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
    try {
      return await transacao(this.pool, (c) => fn(c as unknown as Transacao));
    } catch (e) {
      // Duas operações simultâneas com a mesma chave: a perdedora repete e enxerga a vencedora.
      if ((e as { code?: string }).code === VIOLACAO_UNICIDADE) throw new ConflitoConcorrencia(String(e));
      throw e;
    }
  }
}

export class RepositorioCarteirasPg implements RepositorioCarteiras {
  async garantir(tx: Transacao, usuarioId: string) {
    await cliente(tx).query('INSERT INTO carteiras (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [usuarioId]);
  }

  async carregar(tx: Transacao, usuarioId: string) {
    const { rows } = await cliente(tx).query(
      'SELECT saldo_disponivel, saldo_reservado, versao FROM carteiras WHERE usuario_id = $1',
      [usuarioId],
    );
    const l = rows[0];
    return l && new Carteira(usuarioId, { disponivel: l.saldo_disponivel, reservado: l.saldo_reservado }, l.versao);
  }

  async salvar(tx: Transacao, carteira: Carteira) {
    const c = cliente(tx);
    // Concorrência otimista: só grava se ninguém alterou a carteira desde a leitura.
    const { rowCount } = await c.query(
      `UPDATE carteiras
          SET saldo_disponivel = $2, saldo_reservado = $3, versao = versao + 1, atualizada_em = now()
        WHERE usuario_id = $1 AND versao = $4`,
      [carteira.usuarioId, carteira.disponivel, carteira.reservado, carteira.versao],
    );
    if (rowCount === 0) throw new ConflitoConcorrencia(`Carteira ${carteira.usuarioId} alterada concorrentemente`);

    for (const l of carteira.novosLancamentos) {
      await c.query(
        `INSERT INTO lancamentos (id, usuario_id, tipo, creditos, chave_idempotencia, descricao, criado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [l.id, l.usuarioId, l.tipo, l.creditos, l.chaveIdempotencia, l.descricao ?? null, l.criadoEm],
      );
    }
  }

  async lancamentoExiste(tx: Transacao, tipo: string, chave: string) {
    const { rowCount } = await cliente(tx).query(
      'SELECT 1 FROM lancamentos WHERE tipo = $1 AND chave_idempotencia = $2',
      [tipo, chave],
    );
    return rowCount! > 0;
  }
}

export class RepositorioReservasPg implements RepositorioReservas {
  constructor(private readonly pool: Pool) {}

  async buscar(tx: Transacao, chave: string): Promise<Reserva | undefined> {
    const { rows } = await cliente(tx).query('SELECT * FROM reservas WHERE chave = $1 FOR UPDATE', [chave]);
    const l = rows[0];
    return (
      l && {
        chave: l.chave,
        usuarioId: l.usuario_id,
        tipoRegistro: l.tipo_registro,
        creditos: l.creditos,
        estado: l.estado,
        expiraEm: l.expira_em,
        criadaEm: l.criada_em,
      }
    );
  }

  async inserir(tx: Transacao, r: Reserva) {
    await cliente(tx).query(
      `INSERT INTO reservas (chave, usuario_id, tipo_registro, creditos, estado, expira_em, criada_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [r.chave, r.usuarioId, r.tipoRegistro, r.creditos, r.estado, r.expiraEm, r.criadaEm],
    );
  }

  async finalizar(tx: Transacao, chave: string, estado: 'CONSUMIDA' | 'ESTORNADA', quando: Date) {
    await cliente(tx).query('UPDATE reservas SET estado = $2, finalizada_em = $3 WHERE chave = $1', [
      chave,
      estado,
      quando,
    ]);
  }

  async expiradas(agora: Date, limite: number) {
    const { rows } = await this.pool.query(
      `SELECT chave FROM reservas WHERE estado = 'ATIVA' AND expira_em <= $1 ORDER BY expira_em LIMIT $2`,
      [agora, limite],
    );
    return rows.map((r) => r.chave as string);
  }
}

export class PoliticaConsumoPg implements PoliticaConsumo {
  constructor(private readonly pool: Pool) {}
  async creditosPara(tipoRegistro: string) {
    const { rows } = await this.pool.query('SELECT creditos FROM politica_consumo WHERE tipo_registro = $1', [
      tipoRegistro,
    ]);
    return rows[0]?.creditos as number | undefined;
  }
}

export class ConsultaInvariantesPg implements ConsultaInvariantes {
  constructor(private readonly pool: Pool) {}

  async divergencias() {
    const carteiras = await this.pool.query('SELECT usuario_id, saldo_disponivel, saldo_reservado FROM carteiras');
    const somas = await this.pool.query(
      'SELECT usuario_id, tipo, sum(creditos)::int AS creditos FROM lancamentos GROUP BY usuario_id, tipo',
    );
    const porUsuario = new Map<string, { tipo: TipoLancamento; creditos: number }[]>();
    for (const s of somas.rows) {
      porUsuario.set(s.usuario_id, [...(porUsuario.get(s.usuario_id) ?? []), { tipo: s.tipo, creditos: s.creditos }]);
    }
    // A regra de cálculo é a do domínio (Carteira.saldoDosLancamentos), não duplicada em SQL.
    return carteiras.rows
      .map((c) => ({
        usuarioId: c.usuario_id as string,
        materializado: { disponivel: c.saldo_disponivel, reservado: c.saldo_reservado },
        calculado: Carteira.saldoDosLancamentos(porUsuario.get(c.usuario_id) ?? []),
      }))
      .filter(
        (d) =>
          d.materializado.disponivel !== d.calculado.disponivel || d.materializado.reservado !== d.calculado.reservado,
      );
  }
}

export class RelogioSistema implements Relogio {
  agora() {
    return new Date();
  }
}
