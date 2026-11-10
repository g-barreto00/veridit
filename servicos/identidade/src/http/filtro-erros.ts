import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import {
  ErroAcessoNegado,
  ErroConflito,
  ErroContaBloqueada,
  ErroCredenciais,
  ErroDominio,
  ErroValidacao,
} from '../dominio/erros';

/** Traduz erros de domínio para HTTP. O domínio não conhece status HTTP. */
@Catch()
export class FiltroErros implements ExceptionFilter {
  catch(erro: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (erro instanceof HttpException) {
      res.status(erro.getStatus()).json({ mensagem: erro.message });
      return;
    }
    if (erro instanceof ErroDominio) {
      const status =
        erro instanceof ErroValidacao ? 400
        : erro instanceof ErroCredenciais ? 401
        : erro instanceof ErroAcessoNegado ? 403
        : erro instanceof ErroConflito ? 409
        : erro instanceof ErroContaBloqueada ? 429
        : 400;
      if (erro instanceof ErroContaBloqueada) {
        res.setHeader('Retry-After', Math.ceil((erro.bloqueadoAte.getTime() - Date.now()) / 1000));
      }
      res.status(status).json({ mensagem: erro.message, campos: erro.detalhes });
      return;
    }
    console.error(JSON.stringify({ nivel: 'error', msg: 'erro inesperado', erro: String(erro), pilha: (erro as Error)?.stack }));
    res.status(500).json({ mensagem: 'Erro interno' });
  }
}
