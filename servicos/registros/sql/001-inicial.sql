-- Esquema `registros` (ADR-0010): gestão de registros (C10) e estado da saga (C11).

CREATE TABLE registros (
  id                 uuid PRIMARY KEY,
  usuario_id         uuid        NOT NULL,
  titulo             text        NOT NULL,
  url                text        NOT NULL,
  tipo               text        NOT NULL CHECK (tipo IN ('TELA', 'VIDEO')),
  status             text        NOT NULL,
  motivo_falha       text,
  -- Sessão de captura (preenchido em SessaoIniciada)
  sessao_id          text,
  worker_id          text,
  -- Prazo do estado atual, vigiado pelo Monitor de Prazos (C11)
  prazo_em           timestamptz,
  -- Resultado da selagem (para listagem e detalhes)
  quantidade_imagens int,
  quantidade_videos  int,
  hash_manifesto     text,
  inicio_em          timestamptz NOT NULL,   -- REQ12: data/hora início
  fim_em             timestamptz,            -- REQ12: data/hora fim
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registros_usuario ON registros (usuario_id, inicio_em DESC);
CREATE INDEX registros_prazos ON registros (prazo_em) WHERE prazo_em IS NOT NULL;

-- Histórico das transições da saga (rastreabilidade do fluxo).
CREATE TABLE registros_historico (
  id           bigserial PRIMARY KEY,
  registro_id  uuid        NOT NULL REFERENCES registros(id),
  de           text,
  para         text        NOT NULL,
  motivo       text,
  em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registros_historico_registro ON registros_historico (registro_id, id);
