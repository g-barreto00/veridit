import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ConsultarRegistros } from '../aplicacao/consultar-registros';
import type { CoordenadorSaga } from '../aplicacao/coordenador-saga';
import type { IniciarRegistro } from '../aplicacao/iniciar-registro';
import {
  ErroDominio,
  ErroEstado,
  ErroIndisponivel,
  ErroLimiteSessoes,
  ErroNaoEncontrado,
  ErroSemSaldo,
  ErroValidacao,
} from '../dominio/erros';

export const CASOS_DE_USO = Symbol('CASOS_DE_USO');
export interface CasosDeUso {
  iniciar: IniciarRegistro;
  saga: CoordenadorSaga;
  consultar: ConsultarRegistros;
}

function usuario(req: Request) {
  const id = req.header('x-usuario-id');
  if (!id) throw new UnauthorizedException('Não autenticado');
  return id;
}

/** Rotas do usuário, expostas pelo gateway em /api/registros/*. */
@Controller('registros')
export class RegistrosControlador {
  constructor(@Inject(CASOS_DE_USO) private readonly casos: CasosDeUso) {}

  /** REQ08 — Iniciar registro de conteúdo. 202: a captura segue de forma assíncrona. */
  @Post()
  @HttpCode(202)
  iniciar(@Req() req: Request, @Body() corpo: { titulo: string; url: string; tipo: string }) {
    return this.casos.iniciar.executar({ usuarioId: usuario(req), titulo: corpo?.titulo, url: corpo?.url, tipo: corpo?.tipo });
  }

  /** REQ12 — Listar registros realizados. */
  @Get()
  listar(
    @Req() req: Request,
    @Query('busca') busca?: string,
    @Query('status') status?: string,
    @Query('periodoDias') periodoDias?: string,
    @Query('pagina') pagina?: string,
    @Query('tamanho') tamanho?: string,
  ) {
    return this.casos.consultar.listar(usuario(req), {
      busca,
      status,
      periodoDias: Number(periodoDias) || undefined,
      pagina: Number(pagina) || 1,
      tamanho: Number(tamanho) || 10,
    });
  }

  @Get(':id')
  async detalhar(@Req() req: Request, @Param('id') id: string) {
    const r = await this.casos.consultar.detalhar(usuario(req), id);
    if (!r) throw new NotFoundException('Registro não encontrado');
    return r;
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(@Req() req: Request, @Param('id') id: string) {
    return this.casos.saga.cancelar(usuario(req), id);
  }
}

@Controller()
export class SaudeControlador {
  @Get('saude')
  saude() {
    return { status: 'ok' };
  }
}

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
        : erro instanceof ErroSemSaldo ? 402
        : erro instanceof ErroNaoEncontrado ? 404
        : erro instanceof ErroEstado ? 409
        : erro instanceof ErroLimiteSessoes ? 429
        : erro instanceof ErroIndisponivel ? 503
        : 400;
      res.status(status).json({ mensagem: erro.message, ...(erro.detalhes ?? {}) });
      return;
    }
    console.error(JSON.stringify({ nivel: 'error', msg: 'erro inesperado', erro: String(erro), pilha: (erro as Error)?.stack }));
    res.status(500).json({ mensagem: 'Erro interno' });
  }
}
