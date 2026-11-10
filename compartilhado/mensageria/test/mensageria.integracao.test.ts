/**
 * Teste de integração da mensageria (ADR-0007) contra PostgreSQL e RabbitMQ reais.
 * Pré-requisito: `npm run infra:up` na raiz.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import amqplib from 'amqplib';
import { randomUUID } from 'node:crypto';
import {
  ConsumidorEventos,
  GuardaIdempotenciaPg,
  OutboxPg,
  PublicadorRabbit,
  RelayOutbox,
  RepositorioRelayOutboxPg,
  SQL_TABELAS_MENSAGERIA,
  conectarBroker,
  criarEvento,
  type Registrador,
} from '../src';

const URL_PG = process.env.TEST_PG_URL ?? 'postgres://veridit_admin:admin_dev@localhost:5432/veridit';
const URL_AMQP = process.env.TEST_AMQP_URL ?? 'amqp://veridit:veridit_dev@localhost:5672';
const ESQUEMA = `teste_msg_${Date.now()}`;
const silencioso: Registrador = { info() {}, warn() {}, error() {} };

const esperar = async (cond: () => Promise<boolean> | boolean, ms = 8000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('tempo esgotado');
};

const novoEvento = () =>
  criarEvento(
    'CapturaFalhou',
    { registroId: randomUUID(), motivo: 'teste' },
    { correlationId: randomUUID(), origem: 'teste' },
  );

let pool: Pool;
const conexao = conectarBroker(URL_AMQP, silencioso);
const publicador = new PublicadorRabbit(conexao);
const consumidores: ConsumidorEventos[] = [];

beforeAll(async () => {
  const admin = new Pool({ connectionString: URL_PG });
  await admin.query(`CREATE SCHEMA ${ESQUEMA}`);
  await admin.end();
  pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${ESQUEMA}` });
  await pool.query(SQL_TABELAS_MENSAGERIA);
  await pool.query('CREATE TABLE efeitos (registro_id uuid PRIMARY KEY)');
});

// Cada teste usa filas próprias; ao fim, remove-as para não receberem eventos dos testes seguintes.
const filasCriadas: string[] = [];
afterEach(async () => {
  for (const c of consumidores.splice(0)) await c.parar();
  const conn = await amqplib.connect(URL_AMQP);
  const ch = await conn.createChannel();
  for (const f of filasCriadas.splice(0)) {
    for (const sufixo of ['', '.espera.1', '.espera.2', '.dlq']) await ch.deleteQueue(f + sufixo);
  }
  await conn.close();
});

afterAll(async () => {
  await publicador.fechar();
  await conexao.close();
  await pool.query(`DROP SCHEMA ${ESQUEMA} CASCADE`);
  await pool.end();
});

function novoConsumidor(fila: string, manipulador: Parameters<typeof criarManip>[0]) {
  const c = new ConsumidorEventos(conexao, {
    fila,
    manipuladores: { CapturaFalhou: criarManip(manipulador) },
    guarda: new GuardaIdempotenciaPg(pool),
    maxTentativas: 3,
    atrasoBaseMs: 100,
    registrador: silencioso,
  });
  consumidores.push(c);
  filasCriadas.push(fila);
  return c;
}
const criarManip = (f: (e: any, ctx: any) => Promise<void>) => f;

describe('mensageria', () => {
  it('outbox + relay entregam o evento e a guarda impede processamento duplicado', async () => {
    const fila = `teste.${randomUUID()}`;
    let chamadas = 0;
    await novoConsumidor(fila, async (e, { transacao }) => {
      chamadas++;
      await transacao.query('INSERT INTO efeitos VALUES ($1)', [e.dados.registroId]);
    }).iniciar();

    const evento = novoEvento();
    const cliente = await pool.connect();
    await cliente.query('BEGIN');
    await new OutboxPg().adicionar(cliente, evento);
    await cliente.query('COMMIT');
    cliente.release();

    const relay = new RelayOutbox(new RepositorioRelayOutboxPg(pool), publicador);
    await relay.ciclo();
    // Simula reentrega (ex.: relay caiu depois de publicar e antes de marcar).
    await publicador.publicar(evento);

    await esperar(async () => (await pool.query('SELECT 1 FROM efeitos WHERE registro_id=$1', [evento.dados.registroId])).rowCount === 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(chamadas).toBe(1);
    const { rows } = await pool.query('SELECT publicado_em FROM outbox WHERE id=$1', [evento.id]);
    expect(rows[0].publicado_em).not.toBeNull();
  });

  it('falha transitória: rollback desfaz o efeito e a retentativa aplica uma única vez', async () => {
    const fila = `teste.${randomUUID()}`;
    let tentativas = 0;
    await novoConsumidor(fila, async (e, { transacao }) => {
      tentativas++;
      await transacao.query('INSERT INTO efeitos VALUES ($1)', [e.dados.registroId]);
      if (tentativas === 1) throw new Error('queda simulada');
    }).iniciar();

    const evento = novoEvento();
    await publicador.publicar(evento);
    await esperar(() => tentativas >= 2);
    await new Promise((r) => setTimeout(r, 300));
    const { rowCount } = await pool.query('SELECT 1 FROM efeitos WHERE registro_id=$1', [evento.dados.registroId]);
    expect(rowCount).toBe(1);
    expect(tentativas).toBe(2);
  });

  it('falha persistente: após N tentativas o evento vai para a DLQ', async () => {
    const fila = `teste.${randomUUID()}`;
    let tentativas = 0;
    await novoConsumidor(fila, async () => {
      tentativas++;
      throw new Error('sempre falha');
    }).iniciar();

    const evento = novoEvento();
    await publicador.publicar(evento);

    const conn = await amqplib.connect(URL_AMQP);
    const ch = await conn.createChannel();
    let naDlq: amqplib.GetMessage | false = false;
    await esperar(async () => (naDlq = await ch.get(`${fila}.dlq`, { noAck: true })) !== false);
    await conn.close();

    expect(tentativas).toBe(3);
    const corpo = JSON.parse((naDlq as unknown as amqplib.GetMessage).content.toString());
    expect(corpo.id).toBe(evento.id);
  });
});
