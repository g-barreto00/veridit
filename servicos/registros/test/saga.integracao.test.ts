/**
 * Saga do registro (C11) contra PostgreSQL real, com dublês da Carteira e do Alocador.
 * Pré-requisito: npm run infra:up.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { migrar } from '@veridit/plataforma';
import { SQL_TABELAS_MENSAGERIA, criarEvento, type Registrador } from '@veridit/mensageria';
import type { EventoVeridit } from '@veridit/contratos';
import { comporRegistros } from '../src/composicao';
import { ForaDeOrdem } from '../src/aplicacao/coordenador-saga';
import {
  ErroIndisponivel,
  ErroLimiteSessoes,
  ErroNaoEncontrado,
  ErroSemSaldo,
  ErroValidacao,
} from '../src/dominio/erros';
import { SaldoInsuficiente, type AlocadorSessao, type CarteiraCreditos, type Transacao } from '../src/dominio/portas';

const URL_PG = process.env.TEST_PG_URL ?? 'postgres://veridit_admin:admin_dev@localhost:5432/veridit';
const ESQUEMA = `teste_registros_${Date.now()}`;
const silencioso: Registrador = { info() {}, warn() {}, error() {} };

class CarteiraFalsa implements CarteiraCreditos {
  saldo = 10;
  indisponivel = false;
  reservas = new Map<string, 'ATIVA' | 'CONSUMIDA' | 'ESTORNADA'>();
  async reservar(_u: string, chave: string) {
    if (this.indisponivel) throw new ErroIndisponivel('fora do ar');
    if (this.reservas.has(chave)) return { creditos: 1 };
    if (this.saldo < 1) throw new SaldoInsuficiente(1, this.saldo);
    this.saldo--;
    this.reservas.set(chave, 'ATIVA');
    return { creditos: 1 };
  }
  async consumir(chave: string) {
    this.reservas.set(chave, 'CONSUMIDA');
  }
  async estornar(chave: string) {
    if (this.reservas.get(chave) === 'ATIVA') this.saldo++;
    if (this.reservas.has(chave)) this.reservas.set(chave, 'ESTORNADA');
  }
}

class AlocadorFalso implements AlocadorSessao {
  rotas = new Map<string, unknown>();
  async registrar(rota: { registroId: string }) {
    this.rotas.set(rota.registroId, rota);
  }
  async remover(id: string) {
    this.rotas.delete(id);
  }
}

class RelogioAjustavel {
  deslocamentoMs = 0;
  agora() {
    return new Date(Date.now() + this.deslocamentoMs);
  }
}

let pool: Pool;
let carteira: CarteiraFalsa;
let alocador: AlocadorFalso;
const relogio = new RelogioAjustavel();
let casos: ReturnType<typeof comporRegistros>;
let usuario: string;

const iniciar = (extra: Partial<{ titulo: string; url: string; tipo: string; usuarioId: string }> = {}) =>
  casos.iniciar.executar({ usuarioId: usuario, titulo: 'Publicação em rede social', url: 'exemplo.com/post/1', tipo: 'TELA', ...extra });

/** Entrega um evento ao coordenador numa transação, como faz o consumidor. */
async function entregar(evento: EventoVeridit) {
  const c: PoolClient = await pool.connect();
  try {
    await c.query('BEGIN');
    const tx = c as unknown as Transacao;
    const s = casos.saga;
    if (evento.tipo === 'SessaoIniciada') await s.aoSessaoIniciada(tx, evento);
    if (evento.tipo === 'CapturaConcluida') await s.aoCapturaConcluida(tx, evento);
    if (evento.tipo === 'CapturaFalhou') await s.aoCapturaFalhou(tx, evento);
    if (evento.tipo === 'EvidenciaSelada') await s.aoEvidenciaSelada(tx, evento);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

const meta = (registroId: string) => ({ correlationId: registroId, origem: 'teste' });
const sessaoIniciada = (registroId: string) =>
  criarEvento('SessaoIniciada', { registroId, sessaoId: 's1', workerId: 'w1', enderecoWorker: 'http://w1:7000', tokenSessao: 't', iniciadaEm: new Date().toISOString() }, meta(registroId));
const capturaConcluida = (registroId: string) =>
  criarEvento('CapturaConcluida', { registroId, usuarioId: usuario, sessaoId: 's1', workerId: 'w1', urlInicial: 'https://exemplo.com', inicio: '', fim: '', artefatos: [], metadados: [] }, meta(registroId));
const evidenciaSelada = (registroId: string) =>
  criarEvento('EvidenciaSelada', { registroId, hashManifesto: 'abc', quantidadeImagens: 3, quantidadeVideos: 0, seladaEm: new Date().toISOString() }, meta(registroId));

const status = async (id: string) =>
  (await pool.query('SELECT status FROM registros WHERE id = $1', [id])).rows[0]?.status;
const eventosOutbox = async (id: string) =>
  (await pool.query(`SELECT tipo FROM outbox WHERE payload->>'correlationId' = $1 ORDER BY criado_em`, [id])).rows.map((r) => r.tipo);

beforeAll(async () => {
  const admin = new Pool({ connectionString: URL_PG });
  await admin.query(`CREATE SCHEMA ${ESQUEMA}`);
  await admin.end();
  pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${ESQUEMA}`, max: 20 });
  await migrar(pool, join(__dirname, '..', 'sql'), [SQL_TABELAS_MENSAGERIA]);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA ${ESQUEMA} CASCADE`);
  await pool.end();
});

beforeEach(() => {
  usuario = randomUUID();
  carteira = new CarteiraFalsa();
  alocador = new AlocadorFalso();
  relogio.deslocamentoMs = 0;
  casos = comporRegistros(pool, carteira, alocador, silencioso, relogio);
});

describe('REQ08 — iniciar registro', () => {
  it('reserva créditos, publica CapturaSolicitada e fica Aguardando sessão', async () => {
    const r = await iniciar();
    expect(r.status).toBe('AGUARDANDO_SESSAO');
    expect(r.url).toBe('https://exemplo.com/post/1');
    expect(carteira.reservas.get(r.id)).toBe('ATIVA');
    expect(await eventosOutbox(r.id)).toEqual(['CapturaSolicitada']);
  });

  it('valida campos e recusa vídeo nesta versão', async () => {
    const erro = await iniciar({ titulo: 'x', url: 'ftp://site', tipo: 'VIDEO' }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroValidacao);
    expect(Object.keys(erro.detalhes.campos)).toEqual(['titulo', 'url', 'tipo']);
  });

  it('saldo insuficiente → Recusado, sem solicitar captura', async () => {
    carteira.saldo = 0;
    await expect(iniciar()).rejects.toBeInstanceOf(ErroSemSaldo);
    const { rows } = await pool.query('SELECT id, status FROM registros WHERE usuario_id = $1', [usuario]);
    expect(rows[0].status).toBe('RECUSADO');
    expect(await eventosOutbox(rows[0].id)).toEqual([]);
  });

  it('carteira fora do ar → Falhou, sem solicitar captura', async () => {
    carteira.indisponivel = true;
    await expect(iniciar()).rejects.toBeInstanceOf(ErroIndisponivel);
    const { rows } = await pool.query('SELECT status FROM registros WHERE usuario_id = $1', [usuario]);
    expect(rows[0].status).toBe('FALHOU');
  });

  it('ADR-0009: no máximo 2 sessões simultâneas por usuário, mesmo com pedidos concorrentes', async () => {
    const resultados = await Promise.allSettled(Array.from({ length: 5 }, () => iniciar()));
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(resultados.filter((r) => r.status === 'rejected' && r.reason instanceof ErroLimiteSessoes)).toHaveLength(3);
    expect(carteira.saldo).toBe(8);
  });
});

describe('Saga (C11)', () => {
  it('caminho feliz: sessão → captura → selagem → Concluído, consumindo os créditos', async () => {
    const { id } = await iniciar();

    await entregar(sessaoIniciada(id));
    expect(await status(id)).toBe('EM_CAPTURA');
    expect(alocador.rotas.has(id)).toBe(true);

    await entregar(capturaConcluida(id));
    expect(await status(id)).toBe('SELANDO');
    expect(alocador.rotas.has(id)).toBe(false);

    await entregar(evidenciaSelada(id));
    expect(await status(id)).toBe('CONCLUIDO');
    expect(carteira.reservas.get(id)).toBe('CONSUMIDA');
    expect(await eventosOutbox(id)).toEqual(['CapturaSolicitada', 'RegistroConcluido']);

    const detalhe = await casos.consultar.detalhar(usuario, id);
    expect(detalhe.quantidadeImagens).toBe(3);
    expect(detalhe.fim).not.toBeNull();
    expect(detalhe.historico.map((h: { para: string }) => h.para)).toEqual([
      'INICIADO', 'CREDITOS_RESERVADOS', 'AGUARDANDO_SESSAO', 'EM_CAPTURA', 'SELANDO', 'CONCLUIDO',
    ]);
  });

  it('eventos repetidos não mudam o resultado; eventos fora de ordem pedem nova tentativa', async () => {
    const { id } = await iniciar();
    await expect(entregar(capturaConcluida(id))).rejects.toBeInstanceOf(ForaDeOrdem);
    await entregar(sessaoIniciada(id));
    await entregar(sessaoIniciada(id));
    await entregar(capturaConcluida(id));
    await entregar(evidenciaSelada(id));
    await entregar(evidenciaSelada(id));
    expect(await status(id)).toBe('CONCLUIDO');
    expect(await eventosOutbox(id)).toEqual(['CapturaSolicitada', 'RegistroConcluido']);
  });

  it('CapturaFalhou → Falhou com estorno da reserva (compensação)', async () => {
    const { id } = await iniciar();
    await entregar(sessaoIniciada(id));
    await entregar(criarEvento('CapturaFalhou', { registroId: id, motivo: 'Navegador travou' }, meta(id)));
    expect(await status(id)).toBe('FALHOU');
    expect(carteira.reservas.get(id)).toBe('ESTORNADA');
    expect(carteira.saldo).toBe(10);
    expect(alocador.rotas.has(id)).toBe(false);
  });

  it('cancelamento: só o dono cancela, e os créditos voltam', async () => {
    const { id } = await iniciar();
    await entregar(sessaoIniciada(id));
    await expect(casos.saga.cancelar(randomUUID(), id)).rejects.toBeInstanceOf(ErroNaoEncontrado);
    await casos.saga.cancelar(usuario, id);
    expect(await status(id)).toBe('CANCELADO');
    expect(carteira.saldo).toBe(10);
  });

  it('Monitor de Prazos: sessão que não inicia em 5 min → Falhou com estorno', async () => {
    const { id } = await iniciar();
    relogio.deslocamentoMs = 4 * 60_000;
    await casos.saga.monitorarPrazos();
    expect(await status(id)).toBe('AGUARDANDO_SESSAO');
    relogio.deslocamentoMs = 6 * 60_000;
    await casos.saga.monitorarPrazos();
    expect(await status(id)).toBe('FALHOU');
    expect(carteira.reservas.get(id)).toBe('ESTORNADA');
  });
});

describe('REQ12 — listar registros', () => {
  it('lista só os registros do usuário, com filtros e contadores', async () => {
    const a = await iniciar({ titulo: 'Anúncio em marketplace' });
    const b = await iniciar({ titulo: 'Comentários em portal' });
    await entregar(sessaoIniciada(a.id));
    await entregar(capturaConcluida(a.id));
    await entregar(evidenciaSelada(a.id));
    await casos.saga.cancelar(usuario, b.id);
    const outro = usuario;
    usuario = randomUUID();
    await iniciar();
    usuario = outro;

    const todos = await casos.consultar.listar(usuario, {});
    expect(todos.total).toBe(2);
    expect(todos.contadores).toEqual({ concluidos: 1, emAndamento: 0 });
    expect(todos.itens[0]).toMatchObject({ titulo: 'Comentários em portal', status: 'CANCELADO' });
    expect(Object.keys(todos.itens[0])).toEqual(expect.arrayContaining(['titulo', 'inicio', 'fim', 'status']));

    expect((await casos.consultar.listar(usuario, { busca: 'market' })).itens.map((i) => i.id)).toEqual([a.id]);
    expect((await casos.consultar.listar(usuario, { status: 'concluido' })).total).toBe(1);
    expect(await casos.consultar.detalhar(randomUUID(), a.id)).toBeUndefined();
  });
});
