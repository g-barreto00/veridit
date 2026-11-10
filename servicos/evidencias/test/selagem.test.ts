import { describe, expect, it } from 'vitest';
import { createHash, createHmac, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonCanonico, type CapturaConcluida, type Envelope } from '@veridit/contratos';
import { criarEvento } from '@veridit/mensageria';
import { SelarEvidencia } from '../src/aplicacao/selar-evidencia';
import { VerificarEvidencia } from '../src/aplicacao/verificar-evidencia';
import { ArquivoDivergente, OrigemNaoAutentica } from '../src/dominio/erros';
import { HASH_GENESIS, hashCustodia } from '../src/dominio/manifesto';
import type {
  ArmazenamentoEvidencias,
  Assinador,
  CarimboTempo,
  EtapaCustodia,
  EvidenciaSelada,
  RegistroCustodia,
  RepositorioEvidencias,
  Transacao,
} from '../src/dominio/portas';
import { VerificadorOrigemHmac } from '../src/infra/adaptadores';
import { CarimboRfc3161, lerResposta, montarRequisicao } from '../src/infra/carimbo-rfc3161';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();
const tx = {} as Transacao;

describe('Carimbo do tempo RFC 3161', () => {
  it('lê uma resposta real do FreeTSA: hash carimbado e horário', () => {
    const resposta = readFileSync(join(__dirname, 'fixtures/freetsa-teste.tsr'));
    const lido = lerResposta(resposta);
    expect(lido.status).toBe(0);
    expect(lido.hash.equals(sha('teste\n'))).toBe(true);
    expect(lido.horario.toISOString()).toBe('2026-11-10T15:18:09.000Z');
    const carimbo = new CarimboRfc3161('https://freetsa.org/tsr');
    expect(carimbo.conferir(resposta, sha('teste\n')).confere).toBe(true);
    expect(carimbo.conferir(resposta, sha('outro')).confere).toBe(false);
  });

  it('monta requisição DER com o hash SHA-256', () => {
    const req = montarRequisicao(sha('x'), Buffer.from('0102030405060708', 'hex'));
    expect(req[0]).toBe(0x30);
    expect(req.includes(sha('x'))).toBe(true);
  });
});

describe('Cadeia de custódia', () => {
  it('cada elo depende do anterior: mudar um detalhe muda todos os hashes seguintes', () => {
    const em = new Date('2026-11-10T12:00:00Z');
    const h1 = hashCustodia(HASH_GENESIS, 'r1', 'HASHES_CALCULADOS', { a: 1 }, em);
    const h2 = hashCustodia(h1, 'r1', 'SELADA', {}, em);
    const h1Adulterado = hashCustodia(HASH_GENESIS, 'r1', 'HASHES_CALCULADOS', { a: 2 }, em);
    expect(h1Adulterado).not.toBe(h1);
    expect(hashCustodia(h1Adulterado, 'r1', 'SELADA', {}, em)).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------------------------
// SelarEvidencia com dublês (sem KMS, S3, autoridade de carimbo nem banco)
// ---------------------------------------------------------------------------------------------

const CHAVE_ORIGEM = 'chave-de-teste';
const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

class ArmazenamentoMemoria implements ArmazenamentoEvidencias {
  temporario = new Map<string, Buffer>();
  versoes = new Map<string, Buffer[]>();
  async lerTemporario(chave: string) {
    const b = this.temporario.get(chave);
    if (!b) throw new Error('não existe');
    return b;
  }
  async gravarImutavel(chave: string, conteudo: Buffer) {
    const lista = this.versoes.get(chave) ?? [];
    lista.push(conteudo);
    this.versoes.set(chave, lista);
    return `v${lista.length}`;
  }
  async lerImutavel(chave: string, versao: string) {
    return this.versoes.get(chave)![Number(versao.slice(1)) - 1];
  }
}

/** A assinatura criptográfica real é testada com o KMS (LocalStack) no teste ponta a ponta. */
const assinador: Assinador = {
  assinar: async () => ({ assinatura: Buffer.from('assinatura'), chaveId: 'chave-teste', algoritmo: 'ECDSA_SHA_256' }),
  chavePublicaPem: async () => publicKey.export({ type: 'spki', format: 'pem' }).toString(),
};

const carimbo: CarimboTempo = {
  carimbar: async (digest) => ({ resposta: Buffer.concat([Buffer.from('TSR:'), digest]), horario: new Date('2026-11-10T12:00:00Z'), autoridade: 'tsa.teste' }),
  conferir: (resposta, digest) => ({ confere: resposta.subarray(4).equals(digest), horario: new Date('2026-11-10T12:00:00Z') }),
};

class EvidenciasMemoria implements RepositorioEvidencias {
  dados = new Map<string, EvidenciaSelada>();
  async existe(_tx: Transacao, id: string) { return this.dados.has(id); }
  async salvar(_tx: Transacao, e: EvidenciaSelada) { this.dados.set(e.registroId, e); }
  async buscar(id: string) { return this.dados.get(id); }
}

class CustodiaMemoria implements RegistroCustodia {
  etapas: EtapaCustodia[] = [];
  async registrar(_tx: Transacao, _r: string, etapas: EtapaCustodia[]) { this.etapas.push(...etapas); }
  async verificarCadeia() { return { integra: true, entradas: this.etapas.length }; }
}

function cenario() {
  const armazenamento = new ArmazenamentoMemoria();
  const evidencias = new EvidenciasMemoria();
  const custodia = new CustodiaMemoria();
  const eventos: Envelope[] = [];
  const relogio = { agora: () => new Date('2026-11-10T12:00:00Z') };
  const selar = new SelarEvidencia(
    new VerificadorOrigemHmac(CHAVE_ORIGEM),
    armazenamento,
    assinador,
    carimbo,
    evidencias,
    custodia,
    { registrar: async (_tx, e) => void eventos.push(e) },
    relogio,
  );
  return { armazenamento, evidencias, custodia, eventos, selar };
}

function capturaConcluida(armazenamento: ArmazenamentoMemoria, chave = CHAVE_ORIGEM): CapturaConcluida {
  const png = Buffer.from('imagem-png-de-teste');
  const meta = Buffer.from('{"metadados":true}');
  armazenamento.temporario.set('r1/captura-001.png', png);
  armazenamento.temporario.set('r1/metadados.json', meta);
  const dados = {
    registroId: 'r1', usuarioId: 'u1', sessaoId: 's1', workerId: 'w1', urlInicial: 'https://exemplo.com',
    inicio: '2026-11-10T11:58:00.000Z', fim: '2026-11-10T11:59:00.000Z',
    artefatos: [
      { chave: 'r1/captura-001.png', nomeArquivo: 'captura-001.png', tipo: 'IMAGEM' as const, tamanhoBytes: png.length, sha256: sha(png).toString('hex'), capturadoEm: '2026-11-10T11:58:30.000Z', url: 'https://exemplo.com/' },
      { chave: 'r1/metadados.json', nomeArquivo: 'metadados.json', tipo: 'METADADOS' as const, tamanhoBytes: meta.length, sha256: sha(meta).toString('hex'), capturadoEm: '2026-11-10T11:59:00.000Z', url: 'https://exemplo.com' },
    ],
    metadados: [{ urlFinal: 'https://exemplo.com/' }],
  };
  const assinaturaOrigem = createHmac('sha256', chave).update(jsonCanonico(dados)).digest('hex');
  return criarEvento('CapturaConcluida', { ...dados, assinaturaOrigem }, { correlationId: 'r1', origem: 'teste' });
}

describe('SelarEvidencia (C13, ADR-0004)', () => {
  it('sela: grava no WORM, registra a custódia na ordem da ADR e publica EvidenciaSelada', async () => {
    const c = cenario();
    const evento = capturaConcluida(c.armazenamento);
    await expect(c.selar.executar(tx, evento)).resolves.toBe('selada');

    const prefixo = 'r1/';
    expect([...c.armazenamento.versoes.keys()]).toEqual(
      expect.arrayContaining([
        `${prefixo}arquivos/captura-001.png`, `${prefixo}arquivos/metadados.json`, `${prefixo}manifesto.json`,
        `${prefixo}manifesto.sig`, `${prefixo}manifesto.tsr`, `${prefixo}chave-publica.pem`, `${prefixo}VERIFICACAO.txt`,
      ]),
    );
    expect(c.custodia.etapas.map((e) => e.etapa)).toEqual([
      'ORIGEM_VERIFICADA', 'HASHES_CALCULADOS', 'MANIFESTO_GERADO', 'MANIFESTO_ASSINADO', 'CARIMBO_OBTIDO', 'ARMAZENADO_WORM', 'SELADA',
    ]);
    const manifesto = JSON.parse(c.armazenamento.versoes.get(`${prefixo}manifesto.json`)![0].toString());
    expect(manifesto.arquivos.map((a: { nome: string }) => a.nome)).toEqual(['arquivos/captura-001.png', 'arquivos/metadados.json']);
    expect(c.eventos.map((e) => e.tipo)).toEqual(['EvidenciaSelada']);
    expect(c.evidencias.dados.get('r1')!.quantidadeImagens).toBe(1);

    // Idempotência: o mesmo pedido não sela de novo.
    await expect(c.selar.executar(tx, evento)).resolves.toBe('ja_selada');
  });

  it('recusa evento sem assinatura de origem válida (Verificador de Origem)', async () => {
    const c = cenario();
    await expect(c.selar.executar(tx, capturaConcluida(c.armazenamento, 'chave-errada'))).rejects.toBeInstanceOf(OrigemNaoAutentica);
    expect(c.armazenamento.versoes.size).toBe(0);
  });

  it('detecta arquivo alterado no bucket temporário entre a captura e a selagem', async () => {
    const c = cenario();
    const evento = capturaConcluida(c.armazenamento);
    c.armazenamento.temporario.set('r1/captura-001.png', Buffer.from('imagem-adulterada!!'));
    await expect(c.selar.executar(tx, evento)).rejects.toBeInstanceOf(ArquivoDivergente);
    expect(c.eventos).toHaveLength(0);
  });

  it('verificação: nova versão gravada por cima não altera a evidência selada', async () => {
    const c = cenario();
    await c.selar.executar(tx, capturaConcluida(c.armazenamento));
    // "Adulteração": alguém grava outra versão na mesma chave do WORM.
    await c.armazenamento.gravarImutavel('r1/arquivos/captura-001.png', Buffer.from('falsificada'), 'image/png');

    const v = await new VerificarEvidencia(c.evidencias, c.armazenamento, carimbo).executar('u1', 'r1');
    expect(v!.verificacao.arquivosIntegros).toBe(true);
    expect(v!.verificacao.manifestoIntegro).toBe(true);
    expect(v!.verificacao.carimboConfere).toBe(true);
    expect(await new VerificarEvidencia(c.evidencias, c.armazenamento, carimbo).executar('outro', 'r1')).toBeUndefined();
  });
});
