/**
 * ADR-0007: todo evento leva id único (idempotência), correlationId (rastreio entre serviços)
 * e esquema versionado.
 */
export interface Envelope<TTipo extends string = string, TDados = unknown> {
  /** Id único do evento; consumidores usam para descartar duplicatas. */
  id: string;
  tipo: TTipo;
  versao: number;
  /** Normalmente o id do registro ou do pagamento que originou o fluxo. */
  correlationId: string;
  /** ISO-8601 */
  ocorridoEm: string;
  origem: string;
  dados: TDados;
}
