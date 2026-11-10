export type Perfil = 'ADVOGADO' | 'COMUM' | 'EMPRESA';

export interface Usuario {
  id: string;
  perfil: Perfil;
  nome: string;
  email: string;
  senhaHash: string;
  /** CPF em claro só existe em memória; no banco fica cifrado (ADR-0010). */
  cpf: string;
  numeroOab?: string;
  emailVerificadoEm?: Date;
  falhasLogin: number;
  bloqueadoAte?: Date;
  criadoEm: Date;
}

/** Dados recebidos no cadastro (Apêndice A). Campos específicos variam por perfil (D1). */
export interface DadosCadastro {
  perfil: string;
  nome: string;
  email: string;
  senha: string;
  cpf: string;
  numeroOab?: string;
}

export function normalizarEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Bloqueio progressivo (ADR-0005): a partir da 5ª falha seguida, a conta fica bloqueada por
 * 1, 2, 4, 8... minutos (teto de 60).
 */
export const FALHAS_ANTES_DO_BLOQUEIO = 5;
export function calcularBloqueio(falhas: number, agora = new Date()): Date | undefined {
  if (falhas < FALHAS_ANTES_DO_BLOQUEIO) return undefined;
  const minutos = Math.min(2 ** (falhas - FALHAS_ANTES_DO_BLOQUEIO), 60);
  return new Date(agora.getTime() + minutos * 60_000);
}
