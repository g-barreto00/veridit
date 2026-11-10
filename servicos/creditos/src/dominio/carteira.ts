/**
 * Carteira de créditos como livro-razão (ADR-0008). A carteira é um agregado puro: aplica
 * lançamentos sobre os saldos e protege as invariantes (nunca saldo negativo). Persistência e
 * concorrência ficam fora do domínio.
 */
export type TipoLancamento = 'CREDITO_COMPRA' | 'RESERVA' | 'CONSUMO' | 'ESTORNO_RESERVA' | 'AJUSTE';

export interface Lancamento {
  id: string;
  usuarioId: string;
  tipo: TipoLancamento;
  creditos: number;
  chaveIdempotencia: string;
  descricao?: string;
  criadoEm: Date;
}

export class SaldoInsuficiente extends Error {
  constructor(
    readonly necessario: number,
    readonly disponivel: number,
  ) {
    super(`Saldo insuficiente: necessário ${necessario}, disponível ${disponivel}`);
  }
}

export interface Saldos {
  disponivel: number;
  reservado: number;
}

/** Efeito de cada tipo de lançamento sobre os saldos. */
const EFEITOS: Record<TipoLancamento, (n: number) => Saldos> = {
  CREDITO_COMPRA: (n) => ({ disponivel: n, reservado: 0 }),
  AJUSTE: (n) => ({ disponivel: n, reservado: 0 }),
  RESERVA: (n) => ({ disponivel: -n, reservado: n }),
  CONSUMO: (n) => ({ disponivel: 0, reservado: -n }),
  ESTORNO_RESERVA: (n) => ({ disponivel: n, reservado: -n }),
};

export class Carteira {
  private readonly pendentes: Lancamento[] = [];

  constructor(
    readonly usuarioId: string,
    private saldos: Saldos,
    /** Versão lida do banco, usada na concorrência otimista. */
    readonly versao: number,
  ) {}

  get disponivel() {
    return this.saldos.disponivel;
  }
  get reservado() {
    return this.saldos.reservado;
  }

  /** Lançamentos aplicados nesta unidade de trabalho e ainda não gravados. */
  get novosLancamentos(): readonly Lancamento[] {
    return this.pendentes;
  }

  aplicar(lancamento: Lancamento): void {
    if (lancamento.tipo !== 'AJUSTE' && lancamento.creditos <= 0) {
      throw new Error('Lançamento deve ter quantidade positiva');
    }
    const efeito = EFEITOS[lancamento.tipo](lancamento.creditos);
    const novo = {
      disponivel: this.saldos.disponivel + efeito.disponivel,
      reservado: this.saldos.reservado + efeito.reservado,
    };
    if (novo.disponivel < 0) throw new SaldoInsuficiente(lancamento.creditos, this.saldos.disponivel);
    if (novo.reservado < 0) throw new Error('Saldo reservado ficaria negativo');
    this.saldos = novo;
    this.pendentes.push(lancamento);
  }

  /** Verificador de invariantes: saldo materializado = soma dos lançamentos (ADR-0008). */
  static saldoDosLancamentos(lancamentos: Pick<Lancamento, 'tipo' | 'creditos'>[]): Saldos {
    return lancamentos.reduce(
      (acc, l) => {
        const e = EFEITOS[l.tipo](l.creditos);
        return { disponivel: acc.disponivel + e.disponivel, reservado: acc.reservado + e.reservado };
      },
      { disponivel: 0, reservado: 0 },
    );
  }
}
