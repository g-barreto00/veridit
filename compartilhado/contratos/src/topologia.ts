import { TipoEvento } from './eventos';

/**
 * ADR-0007: um exchange de tópicos para eventos de domínio; cada serviço consome por fila
 * durável própria. Falhas após N tentativas vão para a DLQ.
 */
export const EXCHANGE_EVENTOS = 'veridit.eventos';
export const EXCHANGE_DLX = 'veridit.dlx';

/** Routing key = nome do evento, para facilitar o binding por tipo. */
export const routingKey = (tipo: TipoEvento): string => tipo;

/** ADR-0009: fila de trabalho dos workers de captura (prefetch = 1). */
export const FILA_CAPTURA_SOLICITADA = 'captura.solicitada';

export const MAX_TENTATIVAS = 5;
