import type { Carteira, Saldos } from './carteira';

export interface Transacao {
  readonly __brand: 'Transacao';
}

export interface ExecutorTransacao {
  executar<T>(fn: (tx: Transacao) => Promise<T>): Promise<T>;
}

/** A versão gravada mudou entre a leitura e a escrita (concorrência otimista). */
export class ConflitoConcorrencia extends Error {}

export type EstadoReserva = 'ATIVA' | 'CONSUMIDA' | 'ESTORNADA';

export interface Reserva {
  chave: string;
  usuarioId: string;
  tipoRegistro: string;
  creditos: number;
  estado: EstadoReserva;
  expiraEm: Date;
  criadaEm: Date;
}

export interface RepositorioCarteiras {
  /** Cria a carteira vazia se não existir (idempotente). */
  garantir(tx: Transacao, usuarioId: string): Promise<void>;
  carregar(tx: Transacao, usuarioId: string): Promise<Carteira | undefined>;
  /**
   * Grava os novos lançamentos e a projeção de saldo. Lança ConflitoConcorrencia se a versão
   * mudou desde a leitura.
   */
  salvar(tx: Transacao, carteira: Carteira): Promise<void>;
  /** Lançamento já existe para (tipo, chave)? Garante efeito único por operação. */
  lancamentoExiste(tx: Transacao, tipo: string, chave: string): Promise<boolean>;
}

export interface RepositorioReservas {
  buscar(tx: Transacao, chave: string): Promise<Reserva | undefined>;
  inserir(tx: Transacao, reserva: Reserva): Promise<void>;
  finalizar(tx: Transacao, chave: string, estado: 'CONSUMIDA' | 'ESTORNADA', quando: Date): Promise<void>;
  /** Chaves de reservas ativas vencidas (para o Gerenciador de Reservas). */
  expiradas(agora: Date, limite: number): Promise<string[]>;
}

/** Política de Consumo: quantos créditos cada tipo de registro consome (premissa P3). */
export interface PoliticaConsumo {
  creditosPara(tipoRegistro: string): Promise<number | undefined>;
}

export interface ConsultaInvariantes {
  /** Carteiras cujo saldo materializado difere da soma dos lançamentos. */
  divergencias(): Promise<{ usuarioId: string; materializado: Saldos; calculado: Saldos }[]>;
}

export interface Relogio {
  agora(): Date;
}
