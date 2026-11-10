import { createHmac, timingSafeEqual } from 'node:crypto';
import { GetPublicKeyCommand, KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { jsonCanonico, type CapturaConcluida } from '@veridit/contratos';
import type { ArmazenamentoEvidencias, Assinador, VerificadorOrigem } from '../dominio/portas';

const credenciais = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
};

export const criarS3 = (endpoint: string, region: string) =>
  new S3Client({ endpoint, region, forcePathStyle: true, credentials: credenciais });
export const criarKms = (endpoint: string, region: string) => new KMSClient({ endpoint, region, credentials: credenciais });

/** Buckets captura-temporaria e evidencias (este com Object Lock em modo COMPLIANCE, ADR-0004). */
export class ArmazenamentoS3 implements ArmazenamentoEvidencias {
  constructor(
    private readonly s3: S3Client,
    private readonly bucketTemporario: string,
    private readonly bucketEvidencias: string,
  ) {}

  lerTemporario(chave: string) {
    return this.ler(this.bucketTemporario, chave);
  }

  lerImutavel(chave: string, versao: string) {
    return this.ler(this.bucketEvidencias, chave, versao);
  }

  async gravarImutavel(chave: string, conteudo: Buffer, tipoConteudo: string) {
    // A retenção padrão do bucket (COMPLIANCE) se aplica a cada versão gravada.
    const r = await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketEvidencias,
        Key: chave,
        Body: conteudo,
        ContentType: tipoConteudo,
        ChecksumAlgorithm: 'SHA256',
      }),
    );
    if (!r.VersionId) throw new Error('Bucket de evidências sem versionamento/Object Lock');
    return r.VersionId;
  }

  private async ler(bucket: string, chave: string, versao?: string) {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: chave, VersionId: versao }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
}

/** Assinador (C13): a chave privada fica no KMS e nunca é exportada (ADR-0004). */
export class AssinadorKms implements Assinador {
  private pem?: string;

  constructor(
    private readonly kms: KMSClient,
    private readonly chaveId: string,
  ) {}

  async assinar(digest: Buffer) {
    const r = await this.kms.send(
      new SignCommand({ KeyId: this.chaveId, Message: digest, MessageType: 'DIGEST', SigningAlgorithm: 'ECDSA_SHA_256' }),
    );
    return { assinatura: Buffer.from(r.Signature!), chaveId: r.KeyId ?? this.chaveId, algoritmo: 'ECDSA_SHA_256' };
  }

  async chavePublicaPem() {
    if (!this.pem) {
      const r = await this.kms.send(new GetPublicKeyCommand({ KeyId: this.chaveId }));
      const b64 = Buffer.from(r.PublicKey!).toString('base64').match(/.{1,64}/g)!.join('\n');
      this.pem = `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----\n`;
    }
    return this.pem;
  }
}

/** Verificador de Origem (C13): HMAC do evento com a chave de origem dos workers de captura. */
export class VerificadorOrigemHmac implements VerificadorOrigem {
  constructor(private readonly chave: string) {}

  autentico(dados: CapturaConcluida['dados']): boolean {
    const { assinaturaOrigem, ...resto } = dados;
    if (!assinaturaOrigem) return false;
    const esperada = createHmac('sha256', this.chave).update(jsonCanonico(resto)).digest();
    const recebida = Buffer.from(assinaturaOrigem, 'hex');
    return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
  }
}
