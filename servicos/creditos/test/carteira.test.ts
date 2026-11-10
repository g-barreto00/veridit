import { describe, expect, it } from 'vitest';
import { Carteira, SaldoInsuficiente, type Lancamento, type TipoLancamento } from '../src/dominio/carteira';

const l = (tipo: TipoLancamento, creditos: number): Lancamento => ({
  id: crypto.randomUUID(),
  usuarioId: 'u1',
  tipo,
  creditos,
  chaveIdempotencia: crypto.randomUUID(),
  criadoEm: new Date(),
});

describe('Carteira (domínio)', () => {
  it('reserva move do disponível para o reservado; consumo baixa o reservado', () => {
    const c = new Carteira('u1', { disponivel: 5, reservado: 0 }, 0);
    c.aplicar(l('RESERVA', 2));
    expect([c.disponivel, c.reservado]).toEqual([3, 2]);
    c.aplicar(l('CONSUMO', 2));
    expect([c.disponivel, c.reservado]).toEqual([3, 0]);
  });

  it('estorno devolve o reservado ao disponível', () => {
    const c = new Carteira('u1', { disponivel: 1, reservado: 0 }, 0);
    c.aplicar(l('RESERVA', 1));
    c.aplicar(l('ESTORNO_RESERVA', 1));
    expect([c.disponivel, c.reservado]).toEqual([1, 0]);
  });

  it('nunca deixa o saldo negativo', () => {
    const c = new Carteira('u1', { disponivel: 1, reservado: 0 }, 0);
    expect(() => c.aplicar(l('RESERVA', 2))).toThrow(SaldoInsuficiente);
    expect(() => c.aplicar(l('CONSUMO', 1))).toThrow();
    expect([c.disponivel, c.reservado]).toEqual([1, 0]);
    expect(c.novosLancamentos).toHaveLength(0);
  });

  it('saldo calculado a partir dos lançamentos bate com o aplicado', () => {
    const c = new Carteira('u1', { disponivel: 0, reservado: 0 }, 0);
    const seq = [l('AJUSTE', 5), l('CREDITO_COMPRA', 10), l('RESERVA', 3), l('CONSUMO', 3), l('RESERVA', 2), l('ESTORNO_RESERVA', 2), l('RESERVA', 1)];
    seq.forEach((x) => c.aplicar(x));
    expect(Carteira.saldoDosLancamentos(seq)).toEqual({ disponivel: c.disponivel, reservado: c.reservado });
    expect([c.disponivel, c.reservado]).toEqual([11, 1]);
  });
});
