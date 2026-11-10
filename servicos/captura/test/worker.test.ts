import { describe, expect, it, vi } from 'vitest';
import type { Envelope } from '@veridit/contratos';
import { criarEvento, type PublicadorEventos, type Registrador } from '@veridit/mensageria';
import { AtenderSolicitacao, SessoesAtivas } from '../src/aplicacao/atender-solicitacao';
import { COMANDOS, urlNavegavel, type ContextoComando } from '../src/aplicacao/comandos';
import type { FabricaNavegadores } from '../src/portas';

const silencioso: Registrador = { info() {}, warn() {}, error() {} };

class PublicadorMemoria implements PublicadorEventos {
  eventos: Envelope[] = [];
  async publicar(e: Envelope) {
    this.eventos.push(e);
  }
}

const pedido = (idadeMs = 0) => {
  const e = criarEvento(
    'CapturaSolicitada',
    { registroId: 'r1', usuarioId: 'u1', tipo: 'TELA', urlInicial: 'https://exemplo.com', duracaoMaximaSegundos: 1800 },
    { correlationId: 'r1', origem: 'teste' },
  );
  return { ...e, ocorridoEm: new Date(Date.now() - idadeMs).toISOString() };
};

function atendimento(fabrica: Partial<FabricaNavegadores> = {}) {
  const publicador = new PublicadorMemoria();
  const fab = { criar: vi.fn(), limparOrfaos: vi.fn(), ...fabrica } as unknown as FabricaNavegadores;
  const atender = new AtenderSolicitacao(
    { chaveOrigem: 'k', workerId: 'w1', enderecoWorker: 'http://w1:7000', proxySaida: 'http://proxy:3128', idadeMaximaPedidoMs: 5 * 60_000, ociosidadeMaximaMs: 1000 },
    fab,
    { enviar: vi.fn() },
    () => ({}) as never,
    publicador,
    new SessoesAtivas(),
    silencioso,
  );
  return { atender, publicador, fab };
}

describe('AtenderSolicitacao (C12)', () => {
  it('pedido reentregue (worker caiu no meio) vira CapturaFalhou sem abrir navegador', async () => {
    const { atender, publicador, fab } = atendimento();
    await atender.executar(pedido(), { reentregue: true });
    expect(fab.criar).not.toHaveBeenCalled();
    expect(publicador.eventos.map((e) => e.tipo)).toEqual(['CapturaFalhou']);
  });

  it('pedido mais velho que o prazo de espera não abre navegador', async () => {
    const { atender, publicador, fab } = atendimento();
    await atender.executar(pedido(6 * 60_000), { reentregue: false });
    expect(fab.criar).not.toHaveBeenCalled();
    expect(publicador.eventos[0]).toMatchObject({ tipo: 'CapturaFalhou', dados: { registroId: 'r1' } });
  });

  it('falha ao criar o navegador vira CapturaFalhou', async () => {
    const { atender, publicador } = atendimento({ criar: vi.fn().mockRejectedValue(new Error('docker fora')) });
    await atender.executar(pedido(), { reentregue: false });
    expect(publicador.eventos[0].tipo).toBe('CapturaFalhou');
  });
});

describe('Comandos da sessão', () => {
  it('só navega para http/https', () => {
    expect(urlNavegavel('exemplo.com/a')).toBe('https://exemplo.com/a');
    expect(urlNavegavel('http://exemplo.com')).toBe('http://exemplo.com/');
    for (const ruim of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'data:text/html,x']) {
      expect(urlNavegavel(ruim)).toBeUndefined();
    }
  });

  it('limita coordenadas e repassa mouse e rolagem ao navegador', async () => {
    const mouse = { move: vi.fn(), down: vi.fn(), up: vi.fn(), wheel: vi.fn() };
    const ctx = { pagina: { mouse } } as unknown as ContextoComando;
    await COMANDOS.mouse(ctx, { tipo: 'mouse', acao: 'down', x: 1e9, y: 10, botao: 'left' });
    expect(mouse.move).toHaveBeenCalledWith(10_000, 10);
    expect(mouse.down).toHaveBeenCalledWith({ button: 'left' });
    await COMANDOS.rolar(ctx, { tipo: 'rolar', x: 1, y: 2, deltaX: 0, deltaY: 400 });
    expect(mouse.wheel).toHaveBeenCalledWith(0, 400);
  });

  it('caractere imprimível é digitado no keydown; teclas especiais usam down/up', async () => {
    const keyboard = { type: vi.fn(), down: vi.fn(), up: vi.fn() };
    const ctx = { pagina: { keyboard } } as unknown as ContextoComando;
    await COMANDOS.tecla(ctx, { tipo: 'tecla', acao: 'down', tecla: 'ç' });
    await COMANDOS.tecla(ctx, { tipo: 'tecla', acao: 'up', tecla: 'ç' });
    await COMANDOS.tecla(ctx, { tipo: 'tecla', acao: 'down', tecla: 'Enter' });
    expect(keyboard.type).toHaveBeenCalledTimes(1);
    expect(keyboard.down).toHaveBeenCalledWith('Enter');
  });

  it('navegar recusa endereço inválido', async () => {
    const ctx = { pagina: { goto: vi.fn() } } as unknown as ContextoComando;
    await expect(COMANDOS.navegar(ctx, { tipo: 'navegar', url: 'file:///etc/passwd' })).rejects.toThrow();
  });
});
