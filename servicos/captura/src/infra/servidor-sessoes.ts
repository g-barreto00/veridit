import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import type { Registrador } from '@veridit/mensageria';
import type { SessoesAtivas } from '../aplicacao/atender-solicitacao';

/**
 * Ponte de Streaming (C12): WebSocket em /sessoes/:id/ws?token=...
 * Só o gateway conhece o token (via rota registrada pelo Alocador de Sessão). Mesmo que a página
 * aberta no navegador alcance este worker pela rede-captura, sem o token não comanda nada.
 */
export function criarServidorSessoes(sessoes: SessoesAtivas, log: Registrador): Server {
  const servidor = createServer((req, res) => {
    if (req.url === '/saude') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessoes: sessoes.todas().length }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  servidor.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://worker');
    const m = url.pathname.match(/^\/sessoes\/([0-9a-f-]{36})\/ws$/);
    const sessao = m && sessoes.obter(m[1]);
    const token = url.searchParams.get('token') ?? '';
    if (!sessao || !tokensIguais(token, sessao.dados.token)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      log.info('cliente conectado à sessão', { sessaoId: sessao.dados.sessaoId });
      void sessao.conectar(ws).catch((e) => log.error('falha ao conectar cliente', { erro: String(e) }));
    });
  });

  return servidor;
}

function tokensIguais(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
