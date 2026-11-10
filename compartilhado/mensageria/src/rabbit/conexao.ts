import amqp, { AmqpConnectionManager } from 'amqp-connection-manager';

export interface Registrador {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

export const registradorConsole: Registrador = {
  info: (m, e) => console.log(JSON.stringify({ nivel: 'info', msg: m, ...e })),
  warn: (m, e) => console.warn(JSON.stringify({ nivel: 'warn', msg: m, ...e })),
  error: (m, e) => console.error(JSON.stringify({ nivel: 'error', msg: m, ...e })),
};

/** Conexão com reconexão automática ao broker. */
export function conectarBroker(url: string, registrador: Registrador = registradorConsole): AmqpConnectionManager {
  const conexao = amqp.connect([url], { heartbeatIntervalInSeconds: 15 });
  conexao.on('connect', () => registrador.info('broker conectado'));
  conexao.on('disconnect', ({ err }) => registrador.warn('broker desconectado', { erro: String(err) }));
  return conexao;
}
