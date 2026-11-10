import type { Envelope, TipoRegistro } from '@veridit/contratos';
import type { Registro, StatusRegistro } from './registro';

export interface Transacao {
  readonly __brand: 'Transacao';
}

export interface ExecutorTransacao {
  executar<T>(fn: (tx: Transacao) => Promise<T>): Promise<T>;
}

/** Repositório do Estado da Saga (C11) e dos registros (C10). */
export interface RepositorioRegistros {
  inserir(tx: Transacao, registro: Registro): Promise<void>;
  /** Carrega com bloqueio da linha: eventos simultâneos do mesmo registro são serializados. */
  carregarParaAlterar(tx: Transacao, id: string): Promise<Registro | undefined>;
  salvar(tx: Transacao, registro: Registro): Promise<void>;
  /** Serializa inícios simultâneos do mesmo usuário (limite de sessões). */
  bloquearUsuario(tx: Transacao, usuarioId: string): Promise<void>;
  contarEmEstados(tx: Transacao, usuarioId: string, estados: StatusRegistro[]): Promise<number>;
  comPrazoVencido(agora: Date, limite: number): Promise<string[]>;
}

export class SaldoInsuficiente extends Error {
  constructor(readonly necessario?: number, readonly disponivel?: number) {
    super('Saldo de créditos insuficiente');
  }
}
export class ReservaEmEstadoInvalido extends Error {}

/** Cliente da Carteira (C11 → C09): chamada síncrona com timeout e retentativa (ADR-0008). */
export interface CarteiraCreditos {
  reservar(usuarioId: string, chave: string, tipo: TipoRegistro): Promise<{ creditos: number }>;
  consumir(chave: string): Promise<void>;
  estornar(chave: string, motivo: string): Promise<void>;
}

/** Alocador de Sessão (C11): registra no gateway a rota sessão → worker. */
export interface AlocadorSessao {
  registrar(
    rota: { registroId: string; usuarioId: string; sessaoId: string; enderecoWorker: string; tokenSessao: string },
    validadeMs: number,
  ): Promise<void>;
  remover(registroId: string): Promise<void>;
}

export interface RegistradorEventos {
  registrar(tx: Transacao, evento: Envelope): Promise<void>;
}

export interface Relogio {
  agora(): Date;
}
