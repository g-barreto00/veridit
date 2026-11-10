import type { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';
import { EXCHANGE_EVENTOS, routingKey, type Envelope, type TipoEvento } from '@veridit/contratos';
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
      setup: (ch: ConfirmChannel) => ch.assertExchange(EXCHANGE_EVENTOS, 'topic', { durable: true }),
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
