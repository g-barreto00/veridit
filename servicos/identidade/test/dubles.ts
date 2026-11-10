import { createHash, randomUUID } from 'node:crypto';
import type {
  EmissorTokenAcesso,
  ExecutorTransacao,
  GeradorTokens,
  HasherSenha,
  RefreshToken,
  RegistradorEventos,
  RepositorioRefreshTokens,
  RepositorioTokensVerificacao,
  RepositorioUsuarios,
  Relogio,
  Transacao,
} from '../src/dominio/portas';
import type { Usuario } from '../src/dominio/usuario';
import type { Envelope } from '@veridit/contratos';

/** Implementações em memória das portas: os casos de uso são testados sem banco nem broker. */
export class UsuariosMemoria implements RepositorioUsuarios {
  dados = new Map<string, Usuario>();
  async buscarPorEmail(email: string) { return [...this.dados.values()].find((u) => u.email === email); }
  async buscarPorId(id: string) { return this.dados.get(id); }
  async emailEmUso(email: string) { return !!(await this.buscarPorEmail(email)); }
  async cpfEmUso(cpf: string) { return [...this.dados.values()].some((u) => u.cpf === cpf); }
  async oabEmUso(oab: string) { return [...this.dados.values()].some((u) => u.numeroOab === oab); }
  async inserir(_tx: Transacao, u: Usuario) { this.dados.set(u.id, { ...u }); }
  async registrarFalhaLogin(id: string, falhas: number, bloqueadoAte?: Date) {
    Object.assign(this.dados.get(id)!, { falhasLogin: falhas, bloqueadoAte });
  }
  async zerarFalhasLogin(id: string) { Object.assign(this.dados.get(id)!, { falhasLogin: 0, bloqueadoAte: undefined }); }
  async marcarEmailVerificado(_tx: Transacao, id: string, quando: Date) { this.dados.get(id)!.emailVerificadoEm = quando; }
}

export class TokensVerificacaoMemoria implements RepositorioTokensVerificacao {
  dados = new Map<string, { usuarioId: string; expiraEm: Date; usado?: boolean }>();
  async salvar(_tx: Transacao, hash: string, usuarioId: string, expiraEm: Date) { this.dados.set(hash, { usuarioId, expiraEm }); }
  async consumir(_tx: Transacao, hash: string, agora: Date) {
    const t = this.dados.get(hash);
    if (!t || t.usado || t.expiraEm <= agora) return undefined;
    t.usado = true;
    return t.usuarioId;
  }
}

export class RefreshMemoria implements RepositorioRefreshTokens {
  dados = new Map<string, RefreshToken & { hash: string }>();
  async salvar(_tx: Transacao, t: RefreshToken, hash: string) { this.dados.set(t.id, { ...t, hash }); }
  async buscarPorHash(_tx: Transacao, hash: string) { return [...this.dados.values()].find((t) => t.hash === hash); }
  async marcarSubstituido(_tx: Transacao, id: string, novoId: string) { this.dados.get(id)!.substituidoPor = novoId; }
  async revogarFamilia(f: string) { for (const t of this.dados.values()) if (t.familiaId === f) t.revogadoEm ??= new Date(); }
  async revogarTodosDoUsuario(u: string) { for (const t of this.dados.values()) if (t.usuarioId === u) t.revogadoEm ??= new Date(); }
}

export const hasherFalso: HasherSenha = {
  gerar: async (s) => `hash:${s}`,
  verificar: async (h, s) => h === `hash:${s}`,
};

export const geradorTokens: GeradorTokens = {
  gerar: () => randomUUID(),
  hash: (t) => createHash('sha256').update(t).digest('hex'),
};

export const emissorFalso: EmissorTokenAcesso = {
  emitir: async (u) => ({ token: `jwt-de-${u.id}`, jti: randomUUID(), expiraEm: new Date(Date.now() + 900_000) }),
};

export const transacaoFalsa: ExecutorTransacao = {
  executar: (fn) => fn({} as Transacao),
};

export class EventosMemoria implements RegistradorEventos {
  emitidos: Envelope[] = [];
  async registrar(_tx: Transacao, e: Envelope) { this.emitidos.push(e); }
}

export class RelogioFixo implements Relogio {
  constructor(public atual = new Date('2026-11-10T12:00:00Z')) {}
  agora() { return this.atual; }
  avancarMinutos(m: number) { this.atual = new Date(this.atual.getTime() + m * 60_000); }
}
