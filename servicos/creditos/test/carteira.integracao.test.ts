/**
 * Testes de integração da carteira contra PostgreSQL real (pré-requisito: npm run infra:up).
 * Inclui o teste de conformidade da ADR-0008: N reservas simultâneas com saldo para apenas
 * uma resultam em exatamente um sucesso.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrar } from '@veridit/plataforma';
import { SQL_TABELAS_MENSAGERIA, type Registrador } from '@veridit/mensageria';
import { comporCreditos } from '../src/composicao';
import { ErroEstado, ErroSaldoInsuficiente } from '../src/dominio/erros';

const URL_PG = process.env.TEST_PG_URL ?? 'postgres://veridit_admin:admin_dev@localhost:5432/veridit';
const ESQUEMA = `teste_creditos_${Date.now()}`;
const silencioso: Registrador = { info() {}, warn() {}, error() {} };

class RelogioAjustavel {
  deslocamentoMs = 0;
  agora() {
    return new Date(Date.now() + this.deslocamentoMs);
  }
}

let pool: Pool;
let casos: ReturnType<typeof comporCreditos>;
const relogio = new RelogioAjustavel();
let usuario: string;

const creditar = (creditos: number) =>
  casos.creditar.executar({ usuarioId: usuario, tipo: 'AJUSTE', creditos, chave: randomUUID(), descricao: 'teste' });

beforeAll(async () => {
  const admin = new Pool({ connectionString: URL_PG });
  await admin.query(`CREATE SCHEMA ${ESQUEMA}`);
  await admin.end();
  pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${ESQUEMA}`, max: 20 });
  await migrar(pool, join(__dirname, '..', 'sql'), [SQL_TABELAS_MENSAGERIA]);
  casos = comporCreditos(pool, silencioso, relogio);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA ${ESQUEMA} CASCADE`);
  await pool.end();
});

beforeEach(() => {
  usuario = randomUUID();
  relogio.deslocamentoMs = 0;
});

describe('carteira (PostgreSQL)', () => {
  it('ADR-0008: 20 reservas simultâneas com saldo para 1 → exatamente 1 sucesso', async () => {
    await creditar(1);
    const resultados = await Promise.allSettled(
      Array.from({ length: 20 }, () => casos.reservar.executar(usuario, randomUUID(), 'TELA')),
    );
    const sucessos = resultados.filter((r) => r.status === 'fulfilled');
    const recusas = resultados.filter((r) => r.status === 'rejected' && r.reason instanceof ErroSaldoInsuficiente);
    expect(sucessos).toHaveLength(1);
    expect(recusas).toHaveLength(19);
    expect(await casos.consultar.saldo(usuario)).toEqual({ disponivel: 0, reservado: 1 });
  });

  it('reservas simultâneas com a MESMA chave reservam uma única vez (idempotência)', async () => {
    await creditar(5);
    const chave = randomUUID();
    await Promise.all(Array.from({ length: 10 }, () => casos.reservar.executar(usuario, chave, 'VIDEO')));
    expect(await casos.consultar.saldo(usuario)).toEqual({ disponivel: 3, reservado: 2 });
  });

  it('crédito com a mesma chave só tem efeito uma vez', async () => {
    const chave = randomUUID();
    const entrada = { usuarioId: usuario, tipo: 'CREDITO_COMPRA' as const, creditos: 10, chave, descricao: 'compra' };
    expect(await casos.creditar.executar(entrada)).toBe('creditado');
    expect(await casos.creditar.executar(entrada)).toBe('ja_creditado');
    expect((await casos.consultar.saldo(usuario)).disponivel).toBe(10);
  });

  it('consumo e estorno são idempotentes e mutuamente exclusivos', async () => {
    await creditar(2);
    const a = randomUUID();
    const b = randomUUID();
    await casos.reservar.executar(usuario, a, 'TELA');
    await casos.reservar.executar(usuario, b, 'TELA');

    await casos.consumir.executar(a);
    await casos.consumir.executar(a);
    await expect(casos.estornar.executar(a)).rejects.toBeInstanceOf(ErroEstado);

    await casos.estornar.executar(b);
    await casos.estornar.executar(b);
    await expect(casos.consumir.executar(b)).rejects.toBeInstanceOf(ErroEstado);

    // Estornar reserva que nunca existiu (compensação da saga) não é erro.
    expect(await casos.estornar.executar(randomUUID())).toBeUndefined();
    expect(await casos.consultar.saldo(usuario)).toEqual({ disponivel: 1, reservado: 0 });
  });

  it('Gerenciador de Reservas estorna reservas vencidas', async () => {
    await creditar(1);
    await casos.reservar.executar(usuario, randomUUID(), 'TELA');
    relogio.deslocamentoMs = 61 * 60_000;
    await casos.expirar.executar();
    expect(await casos.consultar.saldo(usuario)).toEqual({ disponivel: 1, reservado: 0 });
  });

  it('Verificador de Invariantes: saldo = soma dos lançamentos; detecta adulteração', async () => {
    await creditar(3);
    await casos.reservar.executar(usuario, randomUUID(), 'TELA');
    expect(await casos.invariantes.executar()).toHaveLength(0);

    await pool.query('UPDATE carteiras SET saldo_disponivel = 99 WHERE usuario_id = $1', [usuario]);
    const divergencias = await casos.invariantes.executar();
    expect(divergencias.map((d) => d.usuarioId)).toContain(usuario);
    await pool.query('UPDATE carteiras SET saldo_disponivel = 2 WHERE usuario_id = $1', [usuario]);
  });

  it('o livro-razão não aceita UPDATE nem DELETE', async () => {
    await creditar(1);
    await pool.query('UPDATE lancamentos SET creditos = 1000 WHERE usuario_id = $1', [usuario]);
    await pool.query('DELETE FROM lancamentos WHERE usuario_id = $1', [usuario]);
    const { rows } = await pool.query('SELECT creditos FROM lancamentos WHERE usuario_id = $1', [usuario]);
    expect(rows).toEqual([{ creditos: 1 }]);
  });
});
