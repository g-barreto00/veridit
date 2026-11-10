import { randomBytes } from 'node:crypto';
import type { CarimboObtido, CarimboTempo } from '../dominio/portas';

// ---------------------------------------------------------------------------------------------
// DER mínimo: o suficiente para montar um TimeStampReq e ler o TimeStampResp (RFC 3161).
// ---------------------------------------------------------------------------------------------

function tamanhoDer(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, conteudo: Buffer) => Buffer.concat([Buffer.from([tag]), tamanhoDer(conteudo.length), conteudo]);
const sequencia = (...partes: Buffer[]) => tlv(0x30, Buffer.concat(partes));
const inteiro = (b: Buffer) => tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);

/** AlgorithmIdentifier { id-sha256 (2.16.840.1.101.3.4.2.1), NULL } */
const ALGORITMO_SHA256 = Buffer.from('300d06096086480165030402010500', 'hex');
const OID_TSTINFO = '060b2a864886f70d0109100104'; // 1.2.840.113549.1.9.16.1.4

interface No {
  tag: number;
  inicio: number; // início do conteúdo
  fim: number;
  filhos: No[];
}

function ler(buf: Buffer, pos = 0): No & { proximo: number } {
  const tag = buf[pos];
  let tam = buf[pos + 1];
  let p = pos + 2;
  if (tam & 0x80) {
    const n = tam & 0x7f;
    tam = 0;
    for (let i = 0; i < n; i++) tam = tam * 256 + buf[p + i];
    p += n;
  }
  const no: No & { proximo: number } = { tag, inicio: p, fim: p + tam, filhos: [], proximo: p + tam };
  if (tag & 0x20) {
    // construído: lê os filhos
    let q = p;
    while (q < p + tam) {
      const filho = ler(buf, q);
      no.filhos.push(filho);
      q = filho.proximo;
    }
  }
  return no;
}
const conteudo = (buf: Buffer, n: No) => buf.subarray(n.inicio, n.fim);

function horarioGeneralizado(texto: string): Date {
  // AAAAMMDDhhmmss[.fff]Z
  const m = texto.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/);
  if (!m) throw new Error(`genTime inválido: ${texto}`);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ''}Z`);
}

export function montarRequisicao(digest: Buffer, nonce = randomBytes(8)): Buffer {
  return sequencia(
    inteiro(Buffer.from([1])), // version
    sequencia(ALGORITMO_SHA256, tlv(0x04, digest)), // messageImprint
    inteiro(nonce), // nonce
    tlv(0x01, Buffer.from([0xff])), // certReq = TRUE (inclui o certificado da TSA na resposta)
  );
}

/** Lê status, hash carimbado e horário (genTime) de um TimeStampResp. */
export function lerResposta(resposta: Buffer): { status: number; hash: Buffer; horario: Date } {
  const raiz = ler(resposta);
  const status = conteudo(resposta, raiz.filhos[0].filhos[0]).readUIntBE(0, conteudo(resposta, raiz.filhos[0].filhos[0]).length);
  const token = raiz.filhos[1];
  if (!token) throw new Error(`Carimbo recusado pela autoridade (status ${status})`);
  // ContentInfo { contentType, [0] SignedData { version, digestAlgorithms, encapContentInfo { eContentType, [0] OCTET STRING } } }
  const signedData = token.filhos[1].filhos[0];
  const encap = signedData.filhos[2];
  if (conteudo(resposta, encap.filhos[0]).toString('hex') !== OID_TSTINFO.slice(4)) throw new Error('Conteúdo não é TSTInfo');
  const tstDer = conteudo(resposta, encap.filhos[1].filhos[0]);
  const tst = ler(tstDer);
  // TSTInfo { version, policy, messageImprint { alg, hashedMessage }, serialNumber, genTime, ... }
  const hash = conteudo(tstDer, tst.filhos[2].filhos[1]);
  const horario = horarioGeneralizado(conteudo(tstDer, tst.filhos[4]).toString('ascii'));
  return { status, hash: Buffer.from(hash), horario };
}

/**
 * Cliente de Carimbo do Tempo (C13). Desvio acordado com a equipe autora: FreeTSA (RFC 3161,
 * fora da ICP-Brasil) no lugar de uma ACT credenciada. Trocar a autoridade = trocar a URL.
 */
export class CarimboRfc3161 implements CarimboTempo {
  constructor(
    private readonly urlAutoridade: string,
    private readonly timeoutMs = 15_000,
  ) {}

  async carimbar(digest: Buffer): Promise<CarimboObtido> {
    const r = await fetch(this.urlAutoridade, {
      method: 'POST',
      headers: { 'content-type': 'application/timestamp-query' },
      body: montarRequisicao(digest),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!r.ok) throw new Error(`Autoridade de carimbo respondeu HTTP ${r.status}`);
    const resposta = Buffer.from(await r.arrayBuffer());
    const lido = lerResposta(resposta);
    if (lido.status > 1) throw new Error(`Carimbo recusado (status ${lido.status})`);
    if (!lido.hash.equals(digest)) throw new Error('Carimbo não corresponde ao hash enviado');
    return { resposta, horario: lido.horario, autoridade: new URL(this.urlAutoridade).host };
  }

  conferir(resposta: Buffer, digest: Buffer) {
    try {
      const lido = lerResposta(resposta);
      return { confere: lido.status <= 1 && lido.hash.equals(digest), horario: lido.horario };
    } catch {
      return { confere: false };
    }
  }
}
