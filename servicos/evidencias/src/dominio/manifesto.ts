import { createHash } from 'node:crypto';
import { jsonCanonico, type MetadadosTecnicos } from '@veridit/contratos';

export interface ArquivoManifesto {
  nome: string;
  tipo: string;
  tamanhoBytes: number;
  sha256: string;
  capturadoEm: string;
  url: string;
}

export interface Manifesto {
  versao: 1;
  algoritmoHash: 'SHA-256';
  registroId: string;
  usuarioId: string;
  urlInicial: string;
  inicioCaptura: string;
  fimCaptura: string;
  sessaoId: string;
  workerId: string;
  arquivos: ArquivoManifesto[];
  metadadosTecnicos: MetadadosTecnicos[];
  geradoEm: string;
}

export const sha256 = (dados: Buffer | string) => createHash('sha256').update(dados).digest();

/**
 * Manifesto (ADR-0004, passo 2): id do registro, usuário, URL, início e fim, metadados técnicos
 * e a lista de arquivos com nome, tamanho e hash. Serializado de forma canônica para que o hash
 * possa ser recalculado por qualquer pessoa a partir do arquivo manifesto.json.
 */
export function serializarManifesto(m: Manifesto): Buffer {
  return Buffer.from(jsonCanonico(m), 'utf8');
}

/** Hash encadeado da cadeia de custódia: H(hash_anterior | registro | etapa | detalhes | em). */
export function hashCustodia(anterior: string, registroId: string, etapa: string, detalhes: unknown, em: Date): string {
  return createHash('sha256')
    .update(jsonCanonico({ anterior, registroId, etapa, detalhes, em: em.toISOString() }))
    .digest('hex');
}

export const HASH_GENESIS = '0'.repeat(64);
