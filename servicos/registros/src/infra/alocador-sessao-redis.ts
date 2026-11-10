import type Redis from 'ioredis';
import type { AlocadorSessao } from '../dominio/portas';

/** Prefixo das rotas de sessão lidas pelo gateway para encaminhar o WebSocket ao worker. */
export const PREFIXO_ROTA_SESSAO = 'rota-sessao:';

/**
 * Alocador de Sessão (C11): registra no cache do gateway a rota registro → worker, com validade
 * igual ao prazo máximo da sessão. O gateway só aceita a conexão se o usuário do token for o dono.
 */
export class AlocadorSessaoRedis implements AlocadorSessao {
  constructor(private readonly redis: Redis) {}

  async registrar(
    rota: { registroId: string; usuarioId: string; sessaoId: string; enderecoWorker: string },
    validadeMs: number,
  ) {
    await this.redis.set(PREFIXO_ROTA_SESSAO + rota.registroId, JSON.stringify(rota), 'PX', validadeMs);
  }

  async remover(registroId: string) {
    await this.redis.del(PREFIXO_ROTA_SESSAO + registroId);
  }
}
