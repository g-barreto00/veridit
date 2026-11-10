import type { Envelope } from '@veridit/contratos';
import type { Perfil, Usuario } from './usuario';

/**
 * Portas do domínio de identidade. A aplicação depende destas interfaces; as implementações
 * (PostgreSQL, Argon2id, JWT) ficam em infra/ (SOLID: inversão de dependência).
 */

/** Transação opaca: a aplicação só a repassa, sem saber que é um cliente PostgreSQL. */
export interface Transacao {
  readonly __brand: 'Transacao';
}

export interface ExecutorTransacao {
  executar<T>(fn: (tx: Transacao) => Promise<T>): Promise<T>;
}

export interface RepositorioUsuarios {
  buscarPorEmail(email: string): Promise<Usuario | undefined>;
  buscarPorId(id: string): Promise<Usuario | undefined>;
  emailEmUso(email: string): Promise<boolean>;
  cpfEmUso(cpf: string): Promise<boolean>;
  oabEmUso(numeroOab: string): Promise<boolean>;
  inserir(tx: Transacao, usuario: Usuario): Promise<void>;
  registrarFalhaLogin(id: string, falhas: number, bloqueadoAte?: Date): Promise<void>;
  zerarFalhasLogin(id: string): Promise<void>;
  marcarEmailVerificado(tx: Transacao, id: string, quando: Date): Promise<void>;
}

export interface RepositorioTokensVerificacao {
  salvar(tx: Transacao, tokenHash: string, usuarioId: string, expiraEm: Date): Promise<void>;
  /** Consome o token se válido e não usado; retorna o usuário dono. */
  consumir(tx: Transacao, tokenHash: string, agora: Date): Promise<string | undefined>;
}

export interface RefreshToken {
  id: string;
  familiaId: string;
  usuarioId: string;
  expiraEm: Date;
  substituidoPor?: string;
  revogadoEm?: Date;
}

export interface RepositorioRefreshTokens {
  salvar(tx: Transacao, token: RefreshToken, tokenHash: string): Promise<void>;
  buscarPorHash(tx: Transacao, tokenHash: string): Promise<RefreshToken | undefined>;
  marcarSubstituido(tx: Transacao, id: string, novoId: string): Promise<void>;
  revogarFamilia(familiaId: string): Promise<void>;
  revogarTodosDoUsuario(usuarioId: string): Promise<void>;
}

export interface HasherSenha {
  gerar(senha: string): Promise<string>;
  verificar(hash: string, senha: string): Promise<boolean>;
}

export interface TokenAcessoEmitido {
  token: string;
  jti: string;
  expiraEm: Date;
}

export interface EmissorTokenAcesso {
  emitir(usuario: { id: string; perfil: Perfil; nome: string }): Promise<TokenAcessoEmitido>;
}

/** Tokens aleatórios opacos (refresh, verificação de e-mail) e seus hashes. */
export interface GeradorTokens {
  gerar(): string;
  hash(token: string): string;
}

/** Registra eventos de domínio na transação corrente (outbox, ADR-0007). */
export interface RegistradorEventos {
  registrar(tx: Transacao, evento: Envelope): Promise<void>;
}

export interface Relogio {
  agora(): Date;
}
