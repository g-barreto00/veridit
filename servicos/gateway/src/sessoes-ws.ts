import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type Redis from 'ioredis';
import type { ListaRevogacao, ValidadorToken } from './seguranca';

/** Mesma chave usada pelo Alocador de Sessão (serviço de Registros). */
const PREFIXO_ROTA_SESSAO = 'rota-sessao:';

interface RotaSessao {
  registroId: string;
  usuarioId: string;
  sessaoId: string;
  enderecoWorker: string;
  tokenSessao: string;
}

type ReqWs = IncomingMessage & { destinoWs?: string };

function recusar(socket: Duplex, status: number, texto: string) {
  socket.write(`HTTP/1.1 ${status} ${texto}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * Proxy WebSocket das sessões de captura (C02 → C12), em /api/sessoes/:registroId/ws?token=<JWT>.
 * O navegador não envia Authorization em WebSocket, por isso o JWT vai na query.
 * Regras: token válido e não revogado, rota registrada pelo Alocador e usuário dono do registro.
 */
export function proxySessoes(servidor: Server, validador: ValidadorToken, revogacao: ListaRevogacao, redis: Redis) {
  const proxy = createProxyMiddleware<ReqWs>({
    router: (req) => req.destinoWs!,
    changeOrigin: true,
    ws: false, // o upgrade é tratado manualmente abaixo, depois da autorização
  });

  servidor.on('upgrade', async (req: ReqWs, socket: Duplex, head: Buffer) => {
    try {
      const url = new URL(req.url ?? '/', 'http://gateway');
      const m = url.pathname.match(/^\/api\/sessoes\/([0-9a-f-]{36})\/ws$/);
      if (!m) return recusar(socket, 404, 'Not Found');

      let usuarioId: string;
      try {
        const identidade = await validador.validar(url.searchParams.get('token') ?? '');
        if (await revogacao.revogado(identidade.jti)) return recusar(socket, 401, 'Unauthorized');
        usuarioId = identidade.usuarioId;
      } catch {
        return recusar(socket, 401, 'Unauthorized');
      }

      const bruto = await redis.get(PREFIXO_ROTA_SESSAO + m[1]);
      if (!bruto) return recusar(socket, 404, 'Not Found');
      const rota = JSON.parse(bruto) as RotaSessao;
      // Cada usuário só acessa a própria sessão (ADR-0001: segurança).
      if (rota.usuarioId !== usuarioId) return recusar(socket, 404, 'Not Found');

      req.destinoWs = rota.enderecoWorker;
      req.url = `/sessoes/${rota.sessaoId}/ws?token=${encodeURIComponent(rota.tokenSessao)}`;
      for (const c of ['authorization', 'cookie']) delete req.headers[c];
      proxy.upgrade(req, socket as never, head);
    } catch {
      recusar(socket, 500, 'Internal Server Error');
    }
  });
}
