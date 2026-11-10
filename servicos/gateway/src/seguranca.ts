import type Redis from 'ioredis';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface Identidade {
  usuarioId: string;
  perfil: string;
  nome: string;
  jti: string;
  /** Expiração do token (epoch em segundos). */
  exp: number;
}

/** Portas do gateway: validação de token, revogação e limite de taxa (SOLID: inversão de dependência). */
export interface ValidadorToken {
  validar(token: string): Promise<Identidade>;
}

export interface ListaRevogacao {
  revogar(jti: string, expiraEmSegundos: number): Promise<void>;
  revogado(jti: string): Promise<boolean>;
}

export interface LimitadorTaxa {
  /** Retorna true se ainda está dentro do limite. */
  permitir(chave: string, maximo: number, janelaSegundos: number): Promise<boolean>;
}

/** Valida assinatura e claims com as chaves públicas publicadas pela Identidade (JWKS). */
export class ValidadorJwks implements ValidadorToken {
  private readonly jwks;

  constructor(
    urlJwks: string,
    private readonly emissor: string,
    private readonly audiencia: string,
  ) {
    this.jwks = createRemoteJWKSet(new URL(urlJwks), { cooldownDuration: 30_000 });
  }

  async validar(token: string): Promise<Identidade> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.emissor,
      audience: this.audiencia,
      algorithms: ['ES256'],
    });
    if (!payload.sub || !payload.jti || !payload.exp) throw new Error('Token incompleto');
    return {
      usuarioId: payload.sub,
      perfil: String(payload.perfil),
      nome: String(payload.nome ?? ''),
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}

/** Lista de revogação em cache (Redis) até o token expirar (ADR-0005: logout com efeito real). */
export class ListaRevogacaoRedis implements ListaRevogacao {
  constructor(private readonly redis: Redis) {}

  async revogar(jti: string, expiraEmSegundos: number) {
    const ttl = Math.max(1, Math.ceil(expiraEmSegundos - Date.now() / 1000));
    await this.redis.set(`revogado:${jti}`, '1', 'EX', ttl);
  }

  async revogado(jti: string) {
    return (await this.redis.exists(`revogado:${jti}`)) === 1;
  }
}

/** Janela fixa por chave (ex.: IP + rota). */
export class LimitadorRedis implements LimitadorTaxa {
  constructor(private readonly redis: Redis) {}

  async permitir(chave: string, maximo: number, janelaSegundos: number) {
    const k = `limite:${chave}`;
    const [[, total]] = (await this.redis.multi().incr(k).expire(k, janelaSegundos, 'NX').exec()) as [
      [unknown, number],
    ];
    return total <= maximo;
  }
}
