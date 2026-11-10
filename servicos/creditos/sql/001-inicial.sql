-- Esquema `creditos` (ADR-0010). Carteira como livro-razão (ADR-0008).

-- Projeção de saldo: materializada e atualizada na MESMA transação dos lançamentos,
-- com controle de concorrência otimista (versao).
CREATE TABLE carteiras (
  usuario_id        uuid PRIMARY KEY,
  saldo_disponivel  int         NOT NULL DEFAULT 0 CHECK (saldo_disponivel >= 0),
  saldo_reservado   int         NOT NULL DEFAULT 0 CHECK (saldo_reservado >= 0),
  versao            int         NOT NULL DEFAULT 0,
  criada_em         timestamptz NOT NULL DEFAULT now(),
  atualizada_em     timestamptz NOT NULL DEFAULT now()
);

-- Livro-razão: somente inserção.
CREATE TABLE lancamentos (
  id                 uuid PRIMARY KEY,
  usuario_id         uuid        NOT NULL REFERENCES carteiras(usuario_id),
  tipo               text        NOT NULL CHECK (tipo IN ('CREDITO_COMPRA', 'RESERVA', 'CONSUMO', 'ESTORNO_RESERVA', 'AJUSTE')),
  creditos           int         NOT NULL,          -- sempre positivo, exceto AJUSTE (pode ser negativo)
  chave_idempotencia text        NOT NULL,          -- id do registro, do pagamento etc.
  descricao          text,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  -- Cada operação com a mesma chave tem efeito uma única vez (ADR-0008)
  UNIQUE (tipo, chave_idempotencia)
);
CREATE INDEX lancamentos_usuario ON lancamentos (usuario_id, criado_em);

CREATE RULE lancamentos_sem_update AS ON UPDATE TO lancamentos DO INSTEAD NOTHING;
CREATE RULE lancamentos_sem_delete AS ON DELETE TO lancamentos DO INSTEAD NOTHING;

CREATE TABLE reservas (
  chave          text PRIMARY KEY,                 -- id do registro (chave de idempotência)
  usuario_id     uuid        NOT NULL REFERENCES carteiras(usuario_id),
  tipo_registro  text        NOT NULL,
  creditos       int         NOT NULL CHECK (creditos > 0),
  estado         text        NOT NULL CHECK (estado IN ('ATIVA', 'CONSUMIDA', 'ESTORNADA')),
  expira_em      timestamptz NOT NULL,
  criada_em      timestamptz NOT NULL DEFAULT now(),
  finalizada_em  timestamptz
);
CREATE INDEX reservas_ativas_expiracao ON reservas (expira_em) WHERE estado = 'ATIVA';

-- Política de consumo (C06/C09): créditos por tipo de registro, configurável (premissa P3).
CREATE TABLE politica_consumo (
  tipo_registro  text PRIMARY KEY,
  creditos       int  NOT NULL CHECK (creditos > 0),
  descricao      text NOT NULL
);
INSERT INTO politica_consumo VALUES
  ('TELA',  1, 'Registro com capturas de tela'),
  ('VIDEO', 2, 'Registro com vídeo de navegação');
