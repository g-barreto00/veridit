import 'reflect-metadata';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import Redis from 'ioredis';
import {
  ConsumidorEventos,
  GuardaIdempotenciaPg,
  PublicadorRabbit,
  RelayOutbox,
  RepositorioRelayOutboxPg,
  SQL_TABELAS_MENSAGERIA,
  conectarBroker,
  registradorConsole as log,
} from '@veridit/mensageria';
import { criarPool, env, envNumero, migrar } from '@veridit/plataforma';
import { comporRegistros } from './composicao';
import { CASOS_DE_USO, FiltroErros, RegistrosControlador, SaudeControlador } from './http/controladores';
import { AlocadorSessaoRedis } from './infra/alocador-sessao-redis';
import { ClienteCarteiraHttp } from './infra/cliente-carteira-http';
import { comoTransacao } from './infra/repositorio-registros-pg';

async function iniciar() {
  const pool = criarPool(env('DATABASE_URL'));
  const aplicadas = await migrar(pool, join(__dirname, '..', 'sql'), [SQL_TABELAS_MENSAGERIA]);
  if (aplicadas.length) log.info('migrações aplicadas', { aplicadas });

  const casos = comporRegistros(
    pool,
    new ClienteCarteiraHttp(env('URL_CREDITOS')),
    new AlocadorSessaoRedis(new Redis(env('REDIS_URL'))),
    log,
  );
  const { saga } = casos;

  const broker = conectarBroker(env('AMQP_URL'));
  new RelayOutbox(new RepositorioRelayOutboxPg(pool), new PublicadorRabbit(broker), {
    aoErro: (e) => log.error('falha no relay do outbox', { erro: String(e) }),
  }).iniciar();

  // Consumidor de Eventos (C11): a guarda abre a transação e o manipulador altera o estado nela.
  await new ConsumidorEventos(broker, {
    fila: 'registros',
    guarda: new GuardaIdempotenciaPg(pool),
    manipuladores: {
      SessaoIniciada: (e, { transacao }) => saga.aoSessaoIniciada(comoTransacao(transacao!), e),
      CapturaConcluida: (e, { transacao }) => saga.aoCapturaConcluida(comoTransacao(transacao!), e),
      CapturaFalhou: (e, { transacao }) => saga.aoCapturaFalhou(comoTransacao(transacao!), e),
      EvidenciaSelada: (e, { transacao }) => saga.aoEvidenciaSelada(comoTransacao(transacao!), e),
      SelagemFalhou: (e, { transacao }) => saga.aoSelagemFalhou(comoTransacao(transacao!), e),
    },
  }).iniciar();

  // Monitor de Prazos (C11)
  setInterval(() => void saga.monitorarPrazos().catch((e) => log.error('falha no monitor de prazos', { erro: String(e) })), 15_000);

  @Module({
    controllers: [RegistrosControlador, SaudeControlador],
    providers: [{ provide: CASOS_DE_USO, useValue: casos }],
  })
  class RegistrosModulo {}

  const app = await NestFactory.create(RegistrosModulo, { logger: ['error', 'warn'] });
  app.useGlobalFilters(new FiltroErros());
  app.enableShutdownHooks();
  const porta = envNumero('PORTA', 3003);
  await app.listen(porta);
  log.info('registros no ar', { porta });
}

iniciar().catch((e) => {
  console.error(e);
  process.exit(1);
});
