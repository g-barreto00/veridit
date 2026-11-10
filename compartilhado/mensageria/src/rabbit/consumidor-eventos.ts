import type { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import {
  EXCHANGE_DLX,
  EXCHANGE_EVENTOS,
  MAX_TENTATIVAS,
  routingKey,
  type Envelope,
  type TipoEvento,
} from '@veridit/contratos';
import type { GuardaIdempotencia, ManipuladorEvento } from '../portas';
import { registradorConsole, type Registrador } from './conexao';

export const EXCHANGE_RETORNO = 'veridit.retorno';
const CABECALHO_TENTATIVA = 'x-tentativa';

export interface OpcoesConsumidor {
  /** Nome da fila durável deste consumidor (também usado como nome na tabela de idempotência). */
  fila: string;
  /** Manipulador por tipo de evento; a fila é ligada ao exchange para estes tipos. */
  manipuladores: Partial<Record<TipoEvento, ManipuladorEvento<any>>>;
  guarda: GuardaIdempotencia;
  /** Mensagens não confirmadas por vez. Workers de captura usam 1 (ADR-0009). */
  prefetch?: number;
  maxTentativas?: number;
  /** Atraso da 1ª retentativa; dobra a cada tentativa (backoff exponencial). */
  atrasoBaseMs?: number;
  registrador?: Registrador;
}

/**
 * Consumidor com (ADR-0007):
 * - fila durável e confirmação manual (ack só depois de processar);
 * - idempotência delegada à GuardaIdempotencia;
 * - retentativas com backoff exponencial em filas de espera com TTL;
 * - após N falhas, envio para a DLQ `<fila>.dlq`.
 */
export class ConsumidorEventos {
  private canal?: ChannelWrapper;
  private readonly maxTentativas: number;
  private readonly atrasoBaseMs: number;
  private readonly log: Registrador;

  constructor(
    private readonly conexao: AmqpConnectionManager,
    private readonly opcoes: OpcoesConsumidor,
  ) {
    this.maxTentativas = opcoes.maxTentativas ?? MAX_TENTATIVAS;
    this.atrasoBaseMs = opcoes.atrasoBaseMs ?? 1000;
    this.log = opcoes.registrador ?? registradorConsole;
  }

  async iniciar(): Promise<void> {
    const { fila } = this.opcoes;
    const tipos = Object.keys(this.opcoes.manipuladores) as TipoEvento[];

    this.canal = this.conexao.createChannel({
      json: false,
      confirm: true,
      setup: async (ch: ConfirmChannel) => {
        await ch.assertExchange(EXCHANGE_EVENTOS, 'topic', { durable: true });
        await ch.assertExchange(EXCHANGE_RETORNO, 'direct', { durable: true });
        await ch.assertExchange(EXCHANGE_DLX, 'direct', { durable: true });

        await ch.assertQueue(fila, { durable: true });
        for (const tipo of tipos) await ch.bindQueue(fila, EXCHANGE_EVENTOS, routingKey(tipo));
        await ch.bindQueue(fila, EXCHANGE_RETORNO, fila);

        // Uma fila de espera por tentativa, com TTL crescente; ao expirar volta para a fila principal.
        for (let n = 1; n < this.maxTentativas; n++) {
          await ch.assertQueue(this.filaEspera(n), {
            durable: true,
            arguments: {
              'x-message-ttl': this.atrasoBaseMs * 2 ** (n - 1),
              'x-dead-letter-exchange': EXCHANGE_RETORNO,
              'x-dead-letter-routing-key': fila,
            },
          });
        }

        await ch.assertQueue(`${fila}.dlq`, { durable: true });
        await ch.bindQueue(`${fila}.dlq`, EXCHANGE_DLX, fila);

        await ch.prefetch(this.opcoes.prefetch ?? 10);
        await ch.consume(fila, (msg) => msg && void this.tratar(ch, msg), { noAck: false });
      },
    });
    await this.canal.waitForConnect();
  }

  async parar(): Promise<void> {
    await this.canal?.close();
  }

  private filaEspera(n: number): string {
    return `${this.opcoes.fila}.espera.${n}`;
  }

  private async tratar(ch: ConfirmChannel, msg: ConsumeMessage): Promise<void> {
    const tentativa = Number(msg.properties.headers?.[CABECALHO_TENTATIVA] ?? 1);
    let evento: Envelope;
    try {
      evento = JSON.parse(msg.content.toString());
    } catch {
      this.log.error('mensagem inválida enviada à DLQ', { fila: this.opcoes.fila });
      await this.enviar(ch, EXCHANGE_DLX, this.opcoes.fila, msg, { 'x-erro': 'JSON inválido' });
      ch.ack(msg);
      return;
    }

    const manipulador = this.opcoes.manipuladores[evento.tipo as TipoEvento];
    if (!manipulador) {
      ch.ack(msg); // evento que este consumidor não trata
      return;
    }

    try {
      const resultado = await this.opcoes.guarda.executarUmaVez(evento, this.opcoes.fila, (transacao) =>
        manipulador(evento, { transacao, tentativa, reentregue: msg.fields.redelivered }),
      );
      if (resultado === 'duplicado') {
        this.log.info('evento duplicado ignorado', { fila: this.opcoes.fila, id: evento.id, tipo: evento.tipo });
      }
      ch.ack(msg);
    } catch (erro) {
      const extra = { fila: this.opcoes.fila, id: evento.id, tipo: evento.tipo, tentativa, erro: String(erro) };
      if (tentativa < this.maxTentativas) {
        this.log.warn('falha ao processar; nova tentativa agendada', extra);
        await this.enviar(ch, '', this.filaEspera(tentativa), msg, { [CABECALHO_TENTATIVA]: tentativa + 1 });
      } else {
        this.log.error('falha definitiva; evento enviado à DLQ', extra);
        await this.enviar(ch, EXCHANGE_DLX, this.opcoes.fila, msg, {
          [CABECALHO_TENTATIVA]: tentativa,
          'x-erro': String(erro),
        });
      }
      ch.ack(msg);
    }
  }

  /** Republica com confirmação antes de dar ack na original (nada se perde se o processo cair). */
  private enviar(
    ch: ConfirmChannel,
    exchange: string,
    chave: string,
    msg: ConsumeMessage,
    cabecalhos: Record<string, unknown>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ch.publish(
        exchange,
        chave,
        msg.content,
        { ...msg.properties, persistent: true, headers: { ...msg.properties.headers, ...cabecalhos } },
        (erro) => (erro ? reject(erro) : resolve()),
      );
    });
  }
}
