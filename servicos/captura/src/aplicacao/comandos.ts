import type { Page } from 'playwright-core';

/** Mensagens que a aplicação web envia pela sessão (WebSocket). */
export type Comando =
  | { tipo: 'mouse'; acao: 'move' | 'down' | 'up'; x: number; y: number; botao?: 'left' | 'right' | 'middle' }
  | { tipo: 'rolar'; x: number; y: number; deltaX: number; deltaY: number }
  | { tipo: 'tecla'; acao: 'down' | 'up'; tecla: string }
  | { tipo: 'navegar'; url: string }
  | { tipo: 'voltar' }
  | { tipo: 'avancar' }
  | { tipo: 'recarregar' }
  | { tipo: 'capturar' }
  | { tipo: 'concluir' }
  | { tipo: 'cancelar' };

/** O que um comando precisa da sessão. */
export interface ContextoComando {
  pagina: Page;
  capturarTela(): Promise<void>;
  concluir(): Promise<void>;
  cancelar(): Promise<void>;
}

type Executor<C extends Comando> = (ctx: ContextoComando, cmd: C) => Promise<unknown>;

export function urlNavegavel(bruta: string): string | undefined {
  const texto = String(bruta ?? '').trim();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(texto) ? texto : `https://${texto}`);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

const numero = (v: unknown, max = 10_000) => Math.max(-max, Math.min(max, Number(v) || 0));
const TECLAS_MODIFICADORAS = ['Shift', 'Control', 'Alt', 'Meta'];

/**
 * Tabela de comandos da sessão (SOLID: aberto/fechado). A gravação de vídeo (REQ09, sprint 2)
 * entra como novos comandos ("iniciarGravacao", "pararGravacao"), sem alterar a sessão.
 */
export const COMANDOS: { [T in Comando['tipo']]: Executor<Extract<Comando, { tipo: T }>> } = {
  mouse: async ({ pagina }, c) => {
    const x = numero(c.x);
    const y = numero(c.y);
    const botao = c.botao && ['left', 'right', 'middle'].includes(c.botao) ? c.botao : 'left';
    if (c.acao === 'move') return pagina.mouse.move(x, y);
    await pagina.mouse.move(x, y);
    return c.acao === 'down' ? pagina.mouse.down({ button: botao }) : pagina.mouse.up({ button: botao });
  },
  rolar: async ({ pagina }, c) => {
    await pagina.mouse.move(numero(c.x), numero(c.y));
    await pagina.mouse.wheel(numero(c.deltaX, 5000), numero(c.deltaY, 5000));
  },
  tecla: async ({ pagina }, c) => {
    const tecla = String(c.tecla ?? '').slice(0, 32);
    if (!tecla) return;
    // Caracteres imprimíveis: "type" gera keydown/keypress/input/keyup completos no keydown.
    if ([...tecla].length === 1 && !TECLAS_MODIFICADORAS.includes(tecla)) {
      if (c.acao === 'down') await pagina.keyboard.type(tecla);
      return;
    }
    try {
      await (c.acao === 'down' ? pagina.keyboard.down(tecla) : pagina.keyboard.up(tecla));
    } catch {
      /* tecla desconhecida pelo navegador: ignora */
    }
  },
  navegar: async ({ pagina }, c) => {
    const url = urlNavegavel(c.url);
    if (!url) throw new Error('Endereço inválido');
    await pagina.goto(url, { waitUntil: 'commit', timeout: 30_000 }).catch(() => undefined);
  },
  voltar: ({ pagina }) => pagina.goBack({ waitUntil: 'commit' }).catch(() => undefined),
  avancar: ({ pagina }) => pagina.goForward({ waitUntil: 'commit' }).catch(() => undefined),
  recarregar: ({ pagina }) => pagina.reload({ waitUntil: 'commit' }).catch(() => undefined),
  capturar: (ctx) => ctx.capturarTela(),
  concluir: (ctx) => ctx.concluir(),
  cancelar: (ctx) => ctx.cancelar(),
};
