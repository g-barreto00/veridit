import type { CapturaConcluida, Envelope } from '@veridit/contratos';

/** Portas do serviço de Evidências (C13 Selagem, C14 Repositório). */

export interface Transacao {
  readonly __brand: 'Transacao';
}

/** Bucket temporário (onde o worker deixou os arquivos) e bucket imutável (WORM). */
export interface ArmazenamentoEvidencias {
  lerTemporario(chave: string): Promise<Buffer>;
  /**
   * Grava no bucket com Object Lock e devolve o VersionId. O lock protege aquela versão;
   * uma gravação posterior na mesma chave cria outra versão, por isso a leitura é sempre por versão.
   */
  gravarImutavel(chave: string, conteudo: Buffer, tipoConteudo: string): Promise<string>;
  lerImutavel(chave: string, versao: string): Promise<Buffer>;
}

/** Assinador (C13): chave privada no KMS, nunca exportada (ADR-0004). */
export interface Assinador {
  /** Assina o SHA-256 já calculado do manifesto. */
  assinar(digestSha256: Buffer): Promise<{ assinatura: Buffer; chaveId: string; algoritmo: string }>;
  chavePublicaPem(): Promise<string>;
}

export interface CarimboObtido {
  /** TimeStampResp DER, como devolvido pela autoridade (RFC 3161). */
  resposta: Buffer;
  horario: Date;
  autoridade: string;
}

/** Cliente de Carimbo do Tempo (C13). */
export interface CarimboTempo {
  carimbar(digestSha256: Buffer): Promise<CarimboObtido>;
  /** Confere se a resposta carimba exatamente este hash e devolve o horário carimbado. */
  conferir(resposta: Buffer, digestSha256: Buffer): { confere: boolean; horario?: Date };
}

/** Verificador de Origem (C13): os artefatos vieram de um worker de captura autenticado. */
export interface VerificadorOrigem {
  autentico(dados: CapturaConcluida['dados']): boolean;
}

export interface EtapaCustodia {
  etapa: string;
  detalhes: Record<string, unknown>;
  em: Date;
}

/** Registro de Custódia (C13): trilha com encadeamento de hashes. */
export interface RegistroCustodia {
  registrar(tx: Transacao, registroId: string, etapas: EtapaCustodia[]): Promise<void>;
  verificarCadeia(): Promise<{ integra: boolean; entradas: number; primeiraQuebra?: number }>;
}

export interface ArquivoSelado {
  nome: string;
  tipo: string;
  tamanhoBytes: number;
  sha256: string;
  capturadoEm: string;
  url: string;
  chaveWorm: string;
  versaoWorm: string;
}

export interface EvidenciaSelada {
  registroId: string;
  usuarioId: string;
  urlInicial: string;
  inicioCaptura: Date;
  fimCaptura: Date;
  hashManifesto: string;
  assinatura: string;
  chaveAssinatura: string;
  algoritmoAssinatura: string;
  carimboHorario: Date;
  carimboTsa: string;
  prefixoWorm: string;
  /** chave → VersionId de todos os objetos selados (arquivos, manifesto, assinatura, carimbo...). */
  versoesWorm: Record<string, string>;
  quantidadeImagens: number;
  quantidadeVideos: number;
  seladaEm: Date;
  arquivos: ArquivoSelado[];
}

export interface RepositorioEvidencias {
  existe(tx: Transacao, registroId: string): Promise<boolean>;
  salvar(tx: Transacao, evidencia: EvidenciaSelada): Promise<void>;
  buscar(registroId: string): Promise<EvidenciaSelada | undefined>;
}

export interface RegistradorEventos {
  registrar(tx: Transacao, evento: Envelope): Promise<void>;
}

export interface Relogio {
  agora(): Date;
}
