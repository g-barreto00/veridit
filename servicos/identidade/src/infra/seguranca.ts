import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { SignJWT, exportJWK, generateKeyPair, importJWK, type JWK, type KeyLike } from 'jose';
import type { Pool } from 'pg';
import type { CriptografiaCampo } from '@veridit/plataforma';
import type { EmissorTokenAcesso, GeradorTokens, HasherSenha } from '../dominio/portas';
import type { Perfil } from '../dominio/usuario';

/** Argon2id com parâmetros recomendados pela OWASP (19 MiB, 2 iterações). ADR-0005. */
export class HasherArgon2id implements HasherSenha {
  gerar(senha: string) {
    return hash(senha, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }
  async verificar(hashSalvo: string, senha: string) {
    try {
      return await verify(hashSalvo, senha);
    } catch {
      return false;
    }
  }
}

/** Tokens opacos de 256 bits; no banco só fica o SHA-256 (ADR-0005). */
export class GeradorTokensSeguros implements GeradorTokens {
  gerar() {
    return randomBytes(32).toString('base64url');
  }
  hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}

export const EMISSOR_JWT = 'veridit-identidade';
export const AUDIENCIA_JWT = 'veridit';
export const VALIDADE_ACESSO_S = 15 * 60; // 15 minutos (ADR-0005)
const ALGORITMO = 'ES256';

/**
 * Par de chaves assimétricas do JWT. O gateway valida só com a chave pública (JWKS).
 * A chave privada fica no banco cifrada com a chave de campo; em produção, viria de um
 * cofre de segredos/KMS.
 */
export class GestorChavesJwt {
  private ativa?: { kid: string; privada: KeyLike | Uint8Array };
  private publicas: JWK[] = [];

  constructor(
    private readonly pool: Pool,
    private readonly cripto: CriptografiaCampo,
  ) {}

  async carregar(): Promise<void> {
    let { rows } = await this.pool.query('SELECT * FROM chaves_jwt WHERE ativa ORDER BY criada_em DESC');
    if (rows.length === 0) {
      const { privateKey, publicKey } = await generateKeyPair(ALGORITMO, { extractable: true });
      const kid = randomUUID();
      const privadaJwk = await exportJWK(privateKey);
      const publicaJwk = { ...(await exportJWK(publicKey)), kid, alg: ALGORITMO, use: 'sig' };
      await this.pool.query(
        'INSERT INTO chaves_jwt (kid, privada_cifrada, publica_jwk) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [kid, this.cripto.cifrar(JSON.stringify(privadaJwk)), publicaJwk],
      );
      ({ rows } = await this.pool.query('SELECT * FROM chaves_jwt WHERE ativa ORDER BY criada_em DESC'));
    }
    const atual = rows[0];
    this.ativa = {
      kid: atual.kid,
      privada: await importJWK(JSON.parse(this.cripto.decifrar(atual.privada_cifrada)), ALGORITMO),
    };
    this.publicas = rows.map((r) => r.publica_jwk);
  }

  chaveAtiva() {
    if (!this.ativa) throw new Error('Chaves JWT não carregadas');
    return this.ativa;
  }

  jwks() {
    return { keys: this.publicas };
  }
}

export class EmissorJwt implements EmissorTokenAcesso {
  constructor(private readonly chaves: GestorChavesJwt) {}

  async emitir(usuario: { id: string; perfil: Perfil; nome: string }) {
    const { kid, privada } = this.chaves.chaveAtiva();
    const jti = randomUUID();
    const agoraS = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ perfil: usuario.perfil, nome: usuario.nome })
      .setProtectedHeader({ alg: ALGORITMO, kid })
      .setSubject(usuario.id)
      .setJti(jti)
      .setIssuer(EMISSOR_JWT)
      .setAudience(AUDIENCIA_JWT)
      .setIssuedAt(agoraS)
      .setExpirationTime(agoraS + VALIDADE_ACESSO_S)
      .sign(privada);
    return { token, jti, expiraEm: new Date((agoraS + VALIDADE_ACESSO_S) * 1000) };
  }
}
