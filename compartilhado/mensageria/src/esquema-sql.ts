/**
 * Tabelas de infraestrutura de mensageria. Cada serviço com banco cria estas tabelas
 * no próprio esquema (ADR-0010), via search_path do usuário do serviço.
 */
export const SQL_TABELAS_MENSAGERIA = `
CREATE TABLE IF NOT EXISTS outbox (
  id            uuid PRIMARY KEY,
  tipo          text        NOT NULL,
  payload       jsonb       NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  publicado_em  timestamptz,
  tentativas    int         NOT NULL DEFAULT 0,
  ultimo_erro   text
);
CREATE INDEX IF NOT EXISTS outbox_pendentes ON outbox (criado_em) WHERE publicado_em IS NULL;

CREATE TABLE IF NOT EXISTS mensagens_processadas (
  id_evento     uuid        NOT NULL,
  consumidor    text        NOT NULL,
  processado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id_evento, consumidor)
);
`;
