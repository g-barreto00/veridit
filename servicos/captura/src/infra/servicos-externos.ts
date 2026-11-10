import { createSocket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ArmazenamentoTemporario, RegistroConexoes, RelogioNtp, ResolvedorDns } from '../portas';

/** S3 compatível (LocalStack em desenvolvimento, premissa P5). */
export class ArmazenamentoS3 implements ArmazenamentoTemporario {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async enviar(chave: string, conteudo: Buffer, tipoConteudo: string) {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: chave, Body: conteudo, ContentType: tipoConteudo }),
    );
  }
}

export function criarClienteS3(endpoint: string, regiao: string) {
  return new S3Client({
    endpoint,
    region: regiao,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  });
}

/**
 * Cliente SNTP mínimo (RFC 4330): pergunta o horário a um servidor NTP. Se não responder,
 * retorna undefined e o relatório registra o horário do sistema como fonte.
 */
export class RelogioSntp implements RelogioNtp {
  constructor(
    private readonly servidor: string,
    private readonly timeoutMs = 2000,
  ) {}

  agora(): Promise<{ horario: Date; fonte: string } | undefined> {
    return new Promise((resolve) => {
      const socket = createSocket('udp4');
      const pacote = Buffer.alloc(48);
      pacote[0] = 0x1b; // LI=0, versão 3, modo cliente
      const fim = (r?: { horario: Date; fonte: string }) => {
        clearTimeout(t);
        socket.close();
        resolve(r);
      };
      const t = setTimeout(() => fim(undefined), this.timeoutMs);
      socket.on('error', () => fim(undefined));
      socket.on('message', (msg) => {
        if (msg.length < 48) return fim(undefined);
        // Transmit Timestamp: segundos desde 1900 (bytes 40-43) + fração (44-47)
        const segundos = msg.readUInt32BE(40) - 2208988800;
        const fracao = msg.readUInt32BE(44) / 2 ** 32;
        fim({ horario: new Date((segundos + fracao) * 1000), fonte: `ntp:${this.servidor}` });
      });
      socket.send(pacote, 123, this.servidor);
    });
  }
}

export class ResolvedorDnsSistema implements ResolvedorDns {
  async resolver(hostname: string) {
    try {
      return (await lookup(hostname, { all: true })).map((r) => r.address);
    } catch {
      return [];
    }
  }
}

/** Consulta ao proxy de saída: conexões feitas por um navegador (IP real de cada destino). */
export class RegistroConexoesProxy implements RegistroConexoes {
  constructor(
    private readonly urlProxy: string,
    private readonly token: string,
  ) {}

  async conexoes(ipNavegador: string) {
    const r = await fetch(`${this.urlProxy}/conexoes?cliente=${encodeURIComponent(ipNavegador)}`, {
      headers: { 'x-token-consulta': this.token },
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return [];
    return (await r.json()) as { host: string; ip: string; porta: number; em: string }[];
  }
}
