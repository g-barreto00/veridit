import { describe, expect, it } from 'vitest';
import { Registro, TransicaoInvalida, type StatusRegistro } from '../src/dominio/registro';

const T0 = new Date('2026-11-10T12:00:00Z');
const novo = () =>
  Registro.novo({ id: 'r1', usuarioId: 'u1', titulo: 'Teste', url: 'https://exemplo.com/', tipo: 'TELA', inicioEm: T0 });

const caminho = (r: Registro, ...estados: StatusRegistro[]) => estados.forEach((s) => r.transicionar(s, T0));

describe('Registro — máquina de estados (diagrama c11-estados)', () => {
  it('percorre o caminho feliz até Concluído', () => {
    const r = novo();
    caminho(r, 'CREDITOS_RESERVADOS', 'AGUARDANDO_SESSAO', 'EM_CAPTURA', 'SELANDO', 'CONCLUIDO');
    expect(r.status).toBe('CONCLUIDO');
    expect(r.estado.fimEm).toEqual(T0);
    expect(r.estado.prazoEm).toBeUndefined();
  });

  it.each<[StatusRegistro[], StatusRegistro]>([
    [[], 'EM_CAPTURA'], // não pula a reserva
    [['CREDITOS_RESERVADOS'], 'SELANDO'],
    [['CREDITOS_RESERVADOS', 'AGUARDANDO_SESSAO'], 'SELANDO'], // não sela sem captura
    [['CREDITOS_RESERVADOS', 'AGUARDANDO_SESSAO', 'EM_CAPTURA', 'SELANDO'], 'CANCELADO'], // não cancela selando
    [['RECUSADO'], 'CREDITOS_RESERVADOS'], // estado final
  ])('recusa transição fora do diagrama: %j → %s', (antes, para) => {
    const r = novo();
    caminho(r, ...antes);
    expect(() => r.transicionar(para, T0)).toThrow(TransicaoInvalida);
  });

  it('só estados com reserva exigem estorno', () => {
    const r = novo();
    expect(r.temReserva).toBe(false);
    caminho(r, 'CREDITOS_RESERVADOS');
    expect(r.temReserva).toBe(true);
    caminho(r, 'AGUARDANDO_SESSAO', 'CANCELADO');
    expect(r.temReserva).toBe(false);
  });

  it('cada estado intermediário recebe um prazo para o Monitor de Prazos', () => {
    const r = novo();
    caminho(r, 'CREDITOS_RESERVADOS', 'AGUARDANDO_SESSAO');
    expect(r.prazoVencido(new Date(T0.getTime() + 4 * 60_000))).toBe(false);
    expect(r.prazoVencido(new Date(T0.getTime() + 6 * 60_000))).toBe(true);
  });

  it('registra o histórico de transições', () => {
    const r = novo();
    caminho(r, 'CREDITOS_RESERVADOS', 'AGUARDANDO_SESSAO', 'CANCELADO');
    expect(r.transicoes.map((t) => t.para)).toEqual(['INICIADO', 'CREDITOS_RESERVADOS', 'AGUARDANDO_SESSAO', 'CANCELADO']);
  });
});
