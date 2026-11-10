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
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ConsultarCarteira } from '../aplicacao/consultar-carteira';
import type { ConsumirReserva, EstornarReserva, ReservarCreditos } from '../aplicacao/operacoes-reserva';
import {
  ErroDominio,
  ErroEstado,
  ErroNaoEncontrado,
  ErroSaldoInsuficiente,
  ErroValidacao,
} from '../dominio/erros';

export const CASOS_DE_USO = Symbol('CASOS_DE_USO');
export interface CasosDeUso {
  reservar: ReservarCreditos;
  consumir: ConsumirReserva;
  estornar: EstornarReserva;
  consultar: ConsultarCarteira;
}

/** Rotas para o usuário, expostas pelo gateway em /api/creditos/*. */
@Controller('creditos')
export class CarteiraControlador {
  constructor(@Inject(CASOS_DE_USO) private readonly casos: CasosDeUso) {}

  private usuario(req: Request) {
    const id = req.header('x-usuario-id');
    if (!id) throw new UnauthorizedException('Não autenticado');
    return id;
  }

  @Get('saldo')
  saldo(@Req() req: Request) {
    return this.casos.consultar.saldo(this.usuario(req));
  }

  @Get('extrato')
  extrato(@Req() req: Request, @Query('limite') limite?: string) {
    return this.casos.consultar.extrato(this.usuario(req), Number(limite) || 50);
  }
}

/**
 * ICarteira (C09) para outros serviços: chamadas síncronas de Registros (ADR-0008).
 * Prefixo /interno: o gateway não roteia estas rotas, só a rede interna as alcança.
 */
@Controller('interno/reservas')
export class ReservasInternoControlador {
  constructor(@Inject(CASOS_DE_USO) private readonly casos: CasosDeUso) {}

  @Post()
  @HttpCode(201)
  reservar(@Body() corpo: { usuarioId: string; chave: string; tipoRegistro: string }) {
    return this.casos.reservar.executar(corpo?.usuarioId, corpo?.chave, corpo?.tipoRegistro);
  }

  @Post(':chave/consumo')
  @HttpCode(200)
  consumir(@Param('chave') chave: string) {
    return this.casos.consumir.executar(chave);
  }

  @Post(':chave/estorno')
  @HttpCode(200)
  async estornar(@Param('chave') chave: string, @Body() corpo: { motivo?: string }) {
    return (await this.casos.estornar.executar(chave, corpo?.motivo)) ?? { chave, estado: 'INEXISTENTE' };
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
        : erro instanceof ErroSaldoInsuficiente ? 402
        : erro instanceof ErroNaoEncontrado ? 404
        : erro instanceof ErroEstado ? 409
        : 400;
      res.status(status).json({ mensagem: erro.message, ...(erro.detalhes ?? {}) });
      return;
    }
    console.error(JSON.stringify({ nivel: 'error', msg: 'erro inesperado', erro: String(erro), pilha: (erro as Error)?.stack }));
    res.status(500).json({ mensagem: 'Erro interno' });
  }
}
