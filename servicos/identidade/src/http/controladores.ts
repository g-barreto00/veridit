import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AutenticarUsuario } from '../aplicacao/autenticar-usuario';
import type { CadastrarUsuario } from '../aplicacao/cadastrar-usuario';
import type { ConsultarUsuario } from '../aplicacao/consultar-usuario';
import type { SessaoEmitida } from '../aplicacao/emissor-sessao';
import type { EncerrarSessao } from '../aplicacao/encerrar-sessao';
import type { RenovarSessao } from '../aplicacao/renovar-sessao';
import type { VerificarEmail } from '../aplicacao/verificar-email';
import type { DadosCadastro } from '../dominio/usuario';
import type { GestorChavesJwt } from '../infra/seguranca';

export const CASOS_DE_USO = Symbol('CASOS_DE_USO');
export const CHAVES_JWT = Symbol('CHAVES_JWT');

export interface CasosDeUso {
  cadastrar: CadastrarUsuario;
  autenticar: AutenticarUsuario;
  renovar: RenovarSessao;
  encerrar: EncerrarSessao;
  verificarEmail: VerificarEmail;
  consultar: ConsultarUsuario;
}

const COOKIE_REFRESH = 'veridit_refresh';
// O navegador acessa via gateway em /api/auth/*; o cookie só é enviado para essas rotas.
const CAMINHO_COOKIE = '/api/auth';

/** Id do usuário autenticado, repassado pelo API Gateway após validar o JWT (ADR-0005). */
export function usuarioAutenticado(req: Request): string {
  const id = req.header('x-usuario-id');
  if (!id) throw new UnauthorizedException('Não autenticado');
  return id;
}

function respostaSessao(res: Response, sessao: SessaoEmitida, usuario: unknown) {
  res.cookie(COOKIE_REFRESH, sessao.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: CAMINHO_COOKIE,
    expires: sessao.refreshExpiraEm,
  });
  return { tokenAcesso: sessao.tokenAcesso, expiraEm: sessao.acessoExpiraEm, usuario };
}

@Controller('auth')
export class AutenticacaoControlador {
  constructor(@Inject(CASOS_DE_USO) private readonly casos: CasosDeUso) {}

  /** REQ01 */
  @Post('cadastro')
  @HttpCode(201)
  cadastrar(@Body() dados: DadosCadastro) {
    return this.casos.cadastrar.executar(dados);
  }

  @Post('verificar-email')
  @HttpCode(204)
  async verificarEmail(@Body() corpo: { token: string }) {
    await this.casos.verificarEmail.executar(corpo?.token);
  }

  /** REQ03 */
  @Post('login')
  @HttpCode(200)
  async login(@Body() corpo: { email: string; senha: string }, @Res({ passthrough: true }) res: Response) {
    const { sessao, usuario } = await this.casos.autenticar.executar(corpo?.email, corpo?.senha);
    return respostaSessao(res, sessao, usuario);
  }

  @Post('renovar')
  @HttpCode(200)
  async renovar(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { sessao, usuario } = await this.casos.renovar.executar(req.cookies?.[COOKIE_REFRESH]);
      return respostaSessao(res, sessao, usuario);
    } catch (e) {
      res.clearCookie(COOKIE_REFRESH, { path: CAMINHO_COOKIE });
      throw e;
    }
  }

  /** REQ04 */
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.casos.encerrar.executar(req.cookies?.[COOKIE_REFRESH], usuarioAutenticado(req));
    res.clearCookie(COOKIE_REFRESH, { path: CAMINHO_COOKIE });
  }
}

@Controller('usuarios')
export class UsuariosControlador {
  constructor(@Inject(CASOS_DE_USO) private readonly casos: CasosDeUso) {}

  @Get('me')
  async eu(@Req() req: Request) {
    const usuario = await this.casos.consultar.executar(usuarioAutenticado(req));
    if (!usuario) throw new UnauthorizedException('Usuário não encontrado');
    return usuario;
  }
}

@Controller()
export class InfraControlador {
  constructor(@Inject(CHAVES_JWT) private readonly chaves: GestorChavesJwt) {}

  /** Chaves públicas para o gateway validar os tokens (ADR-0005). */
  @Get('.well-known/jwks.json')
  jwks() {
    return this.chaves.jwks();
  }

  @Get('saude')
  saude() {
    return { status: 'ok' };
  }
}
