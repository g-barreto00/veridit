import type { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';
import { EXCHANGE_EVENTOS, FILAS, routingKey, type Envelope, type TipoEvento } from '@veridit/contratos';
import type { PublicadorEventos } from '../portas';

/**
 * Publica no exchange de eventos com confirmação do broker (publisher confirms):
 * a promessa só resolve depois que o RabbitMQ gravou a mensagem persistente.
 */
export class PublicadorRabbit implements PublicadorEventos {
  private readonly canal: ChannelWrapper;

  constructor(conexao: AmqpConnectionManager) {
    this.canal = conexao.createChannel({
      json: false,
      confirm: true,
      setup: async (ch: ConfirmChannel) => {
        await ch.assertExchange(EXCHANGE_EVENTOS, 'topic', { durable: true });
        // Garante as filas dos consumidores antes de publicar (ver FILAS em @veridit/contratos).
        for (const [fila, tipos] of Object.entries(FILAS)) {
          await ch.assertQueue(fila, { durable: true });
          for (const tipo of tipos) await ch.bindQueue(fila, EXCHANGE_EVENTOS, routingKey(tipo));
        }
      },
    });
  }

  async publicar(evento: Envelope): Promise<void> {
    await this.canal.publish(
      EXCHANGE_EVENTOS,
      routingKey(evento.tipo as TipoEvento),
      Buffer.from(JSON.stringify(evento)),
      {
        persistent: true,
        contentType: 'application/json',
        messageId: evento.id,
        correlationId: evento.correlationId,
        type: evento.tipo,
      },
    );
  }

  async fechar(): Promise<void> {
    await this.canal.close();
  }
}
