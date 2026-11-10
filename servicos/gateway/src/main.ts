import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import Redis from 'ioredis';
import { env, envNumero } from '@veridit/plataforma';
import { CABECALHOS_INTERNOS, autenticacao, correlacao, limitePorIp } from './middlewares';
import { resolverDestino, type Rota } from './rotas';
import { LimitadorRedis, ListaRevogacaoRedis, ValidadorJwks } from './seguranca';

@Controller('api')
class SaudeControlador {
  @Get('saude')
  saude() {
    return { status: 'ok' };
  }
}

@Module({ controllers: [SaudeControlador] })
class GatewayModulo {}

async function iniciar() {
  const rotas: Rota[] = [
    { prefixo: '/api/auth', destino: env('URL_IDENTIDADE') },
    { prefixo: '/api/usuarios', destino: env('URL_IDENTIDADE') },
    // Próximos passos: créditos, registros, evidências e sessões de captura (WebSocket).
  ];

  const redis = new Redis(env('REDIS_URL'));
  const revogacao = new ListaRevogacaoRedis(redis);
  const validador = new ValidadorJwks(
    `${env('URL_IDENTIDADE')}/.well-known/jwks.json`,
    'veridit-identidade',
    'veridit',
  );

  // bodyParser desligado: o corpo é repassado intacto aos serviços.
  const app = await NestFactory.create<NestExpressApplication>(GatewayModulo, {
    bodyParser: false,
    logger: ['error', 'warn'],
  });
  app.set('trust proxy', 'loopback');

  app.use(correlacao);
  app.use(limitePorIp(new LimitadorRedis(redis)));
  app.use(autenticacao(validador, revogacao));

  const proxy = createProxyMiddleware<Request, ServerResponse>({
    pathFilter: (caminho) => !!resolverDestino(rotas, caminho.split('?')[0]),
    router: (req) => resolverDestino(rotas, req.path)!.destino,
    pathRewrite: { '^/api': '' },
    changeOrigin: true,
    on: {
      proxyReq: (proxyReq, req) => {
        for (const c of CABECALHOS_INTERNOS) proxyReq.removeHeader(c);
        proxyReq.setHeader('x-correlation-id', req.correlationId!);
        if (req.identidade) {
          proxyReq.setHeader('x-usuario-id', req.identidade.usuarioId);
          proxyReq.setHeader('x-usuario-perfil', req.identidade.perfil);
          proxyReq.setHeader('x-usuario-nome', encodeURIComponent(req.identidade.nome));
        }
      },
      proxyRes: (proxyRes, req: IncomingMessage) => {
        const r = req as Request;
        // pathRewrite altera req.url; o caminho original fica em originalUrl.
        const caminhoOriginal = r.originalUrl.split('?')[0];
        // REQ04: logout bem-sucedido → token de acesso atual entra na lista de revogação.
        if (r.method === 'POST' && caminhoOriginal === '/api/auth/logout' && (proxyRes.statusCode ?? 500) < 300 && r.identidade) {
          void revogacao.revogar(r.identidade.jti, r.identidade.exp);
        }
      },
      error: (_erro, _req, res) => {
        const resposta = res as ServerResponse;
        if (!resposta.headersSent) {
          resposta.writeHead(502, { 'content-type': 'application/json' });
        }
        resposta.end(JSON.stringify({ mensagem: 'Serviço indisponível' }));
      },
    },
  });
  app.use(proxy);

  const porta = envNumero('PORTA', 8080);
  await app.listen(porta);
  console.log(JSON.stringify({ nivel: 'info', msg: 'gateway no ar', porta }));
}

iniciar().catch((e) => {
  console.error(e);
  process.exit(1);
});
