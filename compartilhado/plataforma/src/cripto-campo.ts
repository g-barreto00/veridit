import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * ADR-0010: CPF, telefone e endereço criptografados em nível de campo pela aplicação.
 * AES-256-GCM (confidencialidade + integridade). Formato: v1.<iv>.<tag>.<cifra> em base64url.
 * Para buscas por igualdade (ex.: CPF único) usa-se um HMAC separado (`indiceBusca`).
 */
export class CriptografiaCampo {
  private readonly chave: Buffer;
  private readonly chaveIndice: Buffer;

  /** @param chaveBase64 32 bytes em base64 */
  constructor(chaveBase64: string, chaveIndiceBase64: string) {
    this.chave = Buffer.from(chaveBase64, 'base64');
    this.chaveIndice = Buffer.from(chaveIndiceBase64, 'base64');
    if (this.chave.length !== 32 || this.chaveIndice.length !== 32) {
      throw new Error('Chaves de criptografia de campo devem ter 32 bytes (base64)');
    }
  }

  cifrar(texto: string): string {
    const iv = randomBytes(12);
    const cifra = createCipheriv('aes-256-gcm', this.chave, iv);
    const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
    const tag = cifra.getAuthTag();
    return ['v1', iv, tag, dados].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  decifrar(valor: string): string {
    const [versao, iv, tag, dados] = valor.split('.');
    if (versao !== 'v1') throw new Error('Formato de campo cifrado desconhecido');
    const decifra = createDecipheriv('aes-256-gcm', this.chave, Buffer.from(iv, 'base64url'));
    decifra.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decifra.update(Buffer.from(dados, 'base64url')), decifra.final()]).toString('utf8');
  }

  /** HMAC-SHA256 determinístico para índice único/busca sem expor o valor. */
  indiceBusca(texto: string): string {
    return createHmac('sha256', this.chaveIndice).update(texto).digest('hex');
  }
}
