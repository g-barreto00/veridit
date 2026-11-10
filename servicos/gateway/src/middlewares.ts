import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { LIMITES_POR_IP, rotaPublica } from './rotas';
import type { Identidade, LimitadorTaxa, ListaRevogacao, ValidadorToken } from './seguranca';

declare module 'express-serve-static-core' {
  interface Request {
    identidade?: Identidade;
    correlationId?: string;
  }
}

/** Cabeçalhos que só o gateway pode definir; qualquer valor vindo do cliente é descartado. */
export const CABECALHOS_INTERNOS = ['x-usuario-id', 'x-usuario-perfil', 'x-usuario-nome'];

/** Garante um correlationId por requisição (ADR-0002: observabilidade). */
export function correlacao(req: Request, res: Response, next: NextFunction) {
  const recebido = req.header('x-correlation-id');
  req.correlationId = recebido && /^[\w-]{8,64}$/.test(recebido) ? recebido : randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
}

/**
 * Recusa caminhos com segmentos "." / ".." (inclusive codificados), que poderiam escapar do
 * prefixo roteado e alcançar rotas /interno dos serviços.
 */
export function caminhoSeguro(req: Request, res: Response, next: NextFunction) {
  let caminho: string;
  try {
    caminho = decodeURIComponent(req.originalUrl.split('?')[0]);
  } catch {
    res.status(400).json({ mensagem: 'Caminho inválido' });
    return;
  }
  if (caminho.split(/[/\\]/).some((s) => s === '..' || s === '.')) {
    res.status(400).json({ mensagem: 'Caminho inválido' });
    return;
  }
  next();
}

export function limitePorIp(limitador: LimitadorTaxa) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const regra = LIMITES_POR_IP.find((l) => l.caminho === req.path);
    if (!regra) return next();
    try {
      if (await limitador.permitir(`${req.ip}:${regra.caminho}`, regra.maximo, regra.janelaSegundos)) return next();
      res.setHeader('Retry-After', regra.janelaSegundos);
      res.status(429).json({ mensagem: 'Muitas tentativas. Aguarde um minuto e tente novamente.' });
    } catch (e) {
      next(e);
    }
  };
}

/**
 * Exige token válido em toda rota não pública (ADR-0001: 100% dos endpoints, exceto
 * cadastro, login e recuperação de senha, rejeitam requisições sem token válido).
 */
export function autenticacao(validador: ValidadorToken, revogacao: ListaRevogacao) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (rotaPublica(req.method, req.path)) return next();

    const [esquema, token] = (req.header('authorization') ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) {
      res.status(401).json({ mensagem: 'Não autenticado' });
      return;
    }
    try {
      const identidade = await validador.validar(token);
      if (await revogacao.revogado(identidade.jti)) {
        res.status(401).json({ mensagem: 'Sessão encerrada' });
        return;
      }
      req.identidade = identidade;
      next();
    } catch {
      res.status(401).json({ mensagem: 'Token inválido ou expirado' });
    }
  };
}
