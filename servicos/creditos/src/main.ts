import 'reflect-metadata';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PagamentoConfirmado, UsuarioCadastrado } from '@veridit/contratos';
import {
  ConsumidorEventos,
  GuardaIdempotenciaPg,
  SQL_TABELAS_MENSAGERIA,
  conectarBroker,
  registradorConsole as log,
} from '@veridit/mensageria';
import { criarPool, env, envNumero, migrar } from '@veridit/plataforma';
import { comporCreditos } from './composicao';
import {
  CASOS_DE_USO,
  CarteiraControlador,
  FiltroErros,
  ReservasInternoControlador,
  SaudeControlador,
} from './http/controladores';

async function iniciar() {
  const pool = criarPool(env('DATABASE_URL'));
  const aplicadas = await migrar(pool, join(__dirname, '..', 'sql'), [SQL_TABELAS_MENSAGERIA]);
  if (aplicadas.length) log.info('migrações aplicadas', { aplicadas });

  const casos = comporCreditos(pool, log);
  const creditosBoasVindas = envNumero('CREDITOS_BOAS_VINDAS', 5);

  const consumidor = new ConsumidorEventos(conectarBroker(env('AMQP_URL')), {
    fila: 'creditos',
    guarda: new GuardaIdempotenciaPg(pool),
    manipuladores: {
      // Premissa da sprint 1: sem compra (REQ05) ainda, o usuário recebe créditos de boas-vindas
      // como lançamento AJUSTE, tipo previsto na ADR-0008.
      UsuarioCadastrado: async (e: UsuarioCadastrado) => {
        if (creditosBoasVindas <= 0) return;
        await casos.creditar.executar({
          usuarioId: e.dados.usuarioId,
          tipo: 'AJUSTE',
          creditos: creditosBoasVindas,
          chave: `boas-vindas:${e.dados.usuarioId}`,
          descricao: 'Créditos de boas-vindas',
        });
      },
      // Sprint 2 (REQ06): pagamento confirmado vira crédito exatamente uma vez.
      PagamentoConfirmado: async (e: PagamentoConfirmado) => {
        await casos.creditar.executar({
          usuarioId: e.dados.usuarioId,
          tipo: 'CREDITO_COMPRA',
          creditos: e.dados.creditos,
          chave: e.dados.pedidoId,
          descricao: 'Compra de créditos',
        });
      },
    },
  });
  await consumidor.iniciar();

  // Jobs do C09: Gerenciador de Reservas e Verificador de Invariantes.
  setInterval(() => void casos.expirar.executar().catch((e) => log.error('falha ao expirar reservas', { erro: String(e) })), 60_000);
  setInterval(() => void casos.invariantes.executar().catch((e) => log.error('falha na verificação', { erro: String(e) })), 5 * 60_000);

  @Module({
    controllers: [CarteiraControlador, ReservasInternoControlador, SaudeControlador],
    providers: [{ provide: CASOS_DE_USO, useValue: casos }],
  })
  class CreditosModulo {}

  const app = await NestFactory.create(CreditosModulo, { logger: ['error', 'warn'] });
  app.useGlobalFilters(new FiltroErros());
  app.enableShutdownHooks();
  const porta = envNumero('PORTA', 3002);
  await app.listen(porta);
  log.info('créditos no ar', { porta });
}

iniciar().catch((e) => {
  console.error(e);
  process.exit(1);
});
