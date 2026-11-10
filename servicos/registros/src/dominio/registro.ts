import type { TipoRegistro } from '@veridit/contratos';

/**
 * Estados do registro controlados pela saga (diagrama c11-estados do documento de arquitetura).
 */
export type StatusRegistro =
  | 'INICIADO'
  | 'CREDITOS_RESERVADOS'
  | 'AGUARDANDO_SESSAO'
  | 'EM_CAPTURA'
  | 'SELANDO'
  | 'CONCLUIDO'
  | 'RECUSADO'
  | 'FALHOU'
  | 'CANCELADO';

/** Transições permitidas, exatamente as do diagrama c11-estados. */
const TRANSICOES: Record<StatusRegistro, StatusRegistro[]> = {
  INICIADO: ['CREDITOS_RESERVADOS', 'RECUSADO', 'FALHOU'],
  CREDITOS_RESERVADOS: ['AGUARDANDO_SESSAO', 'FALHOU'],
  AGUARDANDO_SESSAO: ['EM_CAPTURA', 'FALHOU', 'CANCELADO'],
  EM_CAPTURA: ['SELANDO', 'FALHOU', 'CANCELADO'],
  SELANDO: ['CONCLUIDO', 'FALHOU'],
  CONCLUIDO: [],
  RECUSADO: [],
  FALHOU: [],
  CANCELADO: [],
};

/** Estados em que os créditos estão reservados e uma falha exige estorno (compensação). */
export const ESTADOS_COM_RESERVA: StatusRegistro[] = ['CREDITOS_RESERVADOS', 'AGUARDANDO_SESSAO', 'EM_CAPTURA', 'SELANDO'];
/** Estados que ocupam uma das sessões simultâneas do usuário (ADR-0009: até 2). */
export const ESTADOS_SESSAO_ATIVA: StatusRegistro[] = ['INICIADO', 'CREDITOS_RESERVADOS', 'AGUARDANDO_SESSAO', 'EM_CAPTURA'];
export const ESTADOS_FINAIS: StatusRegistro[] = ['CONCLUIDO', 'RECUSADO', 'FALHOU', 'CANCELADO'];

/** Prazos de cada estado, vigiados pelo Monitor de Prazos (C11). */
export const PRAZOS_MS: Partial<Record<StatusRegistro, number>> = {
  INICIADO: 60_000,
  CREDITOS_RESERVADOS: 60_000,
  AGUARDANDO_SESSAO: 5 * 60_000,
  // Duração máxima da sessão (30 min, ADR-0003) + margem para o worker publicar o resultado.
  EM_CAPTURA: 32 * 60_000,
  SELANDO: 10 * 60_000,
};

export class TransicaoInvalida extends Error {
  constructor(
    readonly de: StatusRegistro,
    readonly para: StatusRegistro,
  ) {
    super(`Transição inválida: ${de} → ${para}`);
  }
}

export interface Transicao {
  de: StatusRegistro;
  para: StatusRegistro;
  motivo?: string;
  em: Date;
}

export interface DadosRegistro {
  id: string;
  usuarioId: string;
  titulo: string;
  url: string;
  tipo: TipoRegistro;
  status: StatusRegistro;
  motivoFalha?: string;
  sessaoId?: string;
  workerId?: string;
  prazoEm?: Date;
  quantidadeImagens?: number;
  quantidadeVideos?: number;
  hashManifesto?: string;
  inicioEm: Date;
  fimEm?: Date;
}

/** Agregado do registro: aplica as transições da saga e mantém prazo e datas coerentes. */
export class Registro {
  private readonly transicoesPendentes: Transicao[] = [];

  constructor(private dados: DadosRegistro) {}

  static novo(d: Omit<DadosRegistro, 'status' | 'prazoEm'>): Registro {
    const r = new Registro({ ...d, status: 'INICIADO', prazoEm: new Date(d.inicioEm.getTime() + PRAZOS_MS.INICIADO!) });
    r.transicoesPendentes.push({ de: 'INICIADO', para: 'INICIADO', motivo: 'Registro criado', em: d.inicioEm });
    return r;
  }

  get id() { return this.dados.id; }
  get usuarioId() { return this.dados.usuarioId; }
  get status() { return this.dados.status; }
  get estado(): Readonly<DadosRegistro> { return this.dados; }
  get transicoes(): readonly Transicao[] { return this.transicoesPendentes; }
  get temReserva() { return ESTADOS_COM_RESERVA.includes(this.dados.status); }
  get finalizado() { return ESTADOS_FINAIS.includes(this.dados.status); }

  podeIrPara(para: StatusRegistro) {
    return TRANSICOES[this.dados.status].includes(para);
  }

  /** Muda de estado se a transição for permitida pelo diagrama; senão lança TransicaoInvalida. */
  transicionar(para: StatusRegistro, agora: Date, motivo?: string, extras: Partial<DadosRegistro> = {}): void {
    const de = this.dados.status;
    if (!this.podeIrPara(para)) throw new TransicaoInvalida(de, para);
    const prazo = PRAZOS_MS[para];
    this.dados = {
      ...this.dados,
      ...extras,
      status: para,
      prazoEm: prazo ? new Date(agora.getTime() + prazo) : undefined,
      fimEm: ESTADOS_FINAIS.includes(para) ? agora : this.dados.fimEm,
      motivoFalha: para === 'FALHOU' || para === 'RECUSADO' || para === 'CANCELADO' ? motivo : this.dados.motivoFalha,
    };
    this.transicoesPendentes.push({ de, para, motivo, em: agora });
  }

  prazoVencido(agora: Date) {
    return !!this.dados.prazoEm && this.dados.prazoEm <= agora;
  }
}
