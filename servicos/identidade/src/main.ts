import 'reflect-metadata';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { CriptografiaCampo, criarPool, env, envNumero, migrar } from '@veridit/plataforma';
import {
  PublicadorRabbit,
  RelayOutbox,
  RepositorioRelayOutboxPg,
  SQL_TABELAS_MENSAGERIA,
  conectarBroker,
  registradorConsole,
} from '@veridit/mensageria';
import { AutenticarUsuario } from './aplicacao/autenticar-usuario';
import { CadastrarUsuario } from './aplicacao/cadastrar-usuario';
import { ConsultarUsuario } from './aplicacao/consultar-usuario';
import { EmissorSessao } from './aplicacao/emissor-sessao';
import { EncerrarSessao } from './aplicacao/encerrar-sessao';
import { RenovarSessao } from './aplicacao/renovar-sessao';
import { VerificarEmail } from './aplicacao/verificar-email';
import { CatalogoPerfis, RegraAdvogado, RegraUsuarioComum } from './dominio/regras-perfil';
import {
  AutenticacaoControlador,
  CASOS_DE_USO,
  CHAVES_JWT,
  InfraControlador,
  UsuariosControlador,
  type CasosDeUso,
} from './http/controladores';
import { FiltroErros } from './http/filtro-erros';
import { RepositorioUsuariosPg } from './infra/repositorio-usuarios-pg';
import { RepositorioRefreshTokensPg, RepositorioTokensVerificacaoPg } from './infra/repositorios-tokens-pg';
import { EmissorJwt, GeradorTokensSeguros, GestorChavesJwt, HasherArgon2id } from './infra/seguranca';
import { ExecutorTransacaoPg, RegistradorEventosOutbox, RelogioSistema } from './infra/transacao-pg';

/**
 * Ponto de composição: o único lugar que conhece as implementações concretas.
 * Casos de uso recebem apenas interfaces (SOLID: inversão de dependência).
 */
async function iniciar() {
  const pool = criarPool(env('DATABASE_URL'));
  const aplicadas = await migrar(pool, join(__dirname, '..', 'sql'), [SQL_TABELAS_MENSAGERIA]);
  if (aplicadas.length) registradorConsole.info('migrações aplicadas', { aplicadas });

  const cripto = new CriptografiaCampo(env('CHAVE_CRIPTO_CAMPO'), env('CHAVE_INDICE_CAMPO'));
  const chaves = new GestorChavesJwt(pool, cripto);
  await chaves.carregar();

  const usuarios = new RepositorioUsuariosPg(pool, cripto);
  const refresh = new RepositorioRefreshTokensPg(pool);
  const verificacao = new RepositorioTokensVerificacaoPg();
  const hasher = new HasherArgon2id();
  const tokens = new GeradorTokensSeguros();
  const transacao = new ExecutorTransacaoPg(pool);
  const relogio = new RelogioSistema();
  const eventos = new RegistradorEventosOutbox();
  const emissorSessao = new EmissorSessao(new EmissorJwt(chaves), refresh, tokens, relogio);
  // D1: nesta versão, só advogados e usuários comuns.
  const perfis = new CatalogoPerfis([new RegraAdvogado(), new RegraUsuarioComum()]);

  const casos: CasosDeUso = {
    cadastrar: new CadastrarUsuario(perfis, usuarios, verificacao, hasher, tokens, eventos, transacao, relogio),
    autenticar: new AutenticarUsuario(usuarios, hasher, emissorSessao, transacao, relogio),
    renovar: new RenovarSessao(refresh, usuarios, tokens, emissorSessao, transacao, relogio),
    encerrar: new EncerrarSessao(refresh, tokens, transacao),
    verificarEmail: new VerificarEmail(verificacao, usuarios, tokens, transacao, relogio),
    consultar: new ConsultarUsuario(usuarios),
  };

  // Outbox → broker (ADR-0007)
  const broker = conectarBroker(env('AMQP_URL'));
  const relay = new RelayOutbox(new RepositorioRelayOutboxPg(pool), new PublicadorRabbit(broker), {
    aoErro: (e) => registradorConsole.error('falha no relay do outbox', { erro: String(e) }),
  });
  relay.iniciar();

  @Module({
    controllers: [AutenticacaoControlador, UsuariosControlador, InfraControlador],
    providers: [
      { provide: CASOS_DE_USO, useValue: casos },
      { provide: CHAVES_JWT, useValue: chaves },
    ],
  })
  class IdentidadeModulo {}

  const app = await NestFactory.create(IdentidadeModulo, { logger: ['error', 'warn'] });
  app.use(cookieParser());
  app.useGlobalFilters(new FiltroErros());
  app.enableShutdownHooks();
  const porta = envNumero('PORTA', 3001);
  await app.listen(porta);
  registradorConsole.info('identidade no ar', { porta });
}

iniciar().catch((e) => {
  console.error(e);
  process.exit(1);
});
