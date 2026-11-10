-- Esquema `identidade` (ADR-0010). Executado com o usuário identidade_app.

CREATE TABLE usuarios (
  id                   uuid PRIMARY KEY,
  perfil               text        NOT NULL CHECK (perfil IN ('ADVOGADO', 'COMUM', 'EMPRESA')),
  nome                 text        NOT NULL,
  email                text        NOT NULL UNIQUE,
  senha_hash           text        NOT NULL,           -- Argon2id (ADR-0005)
  cpf_cifrado          text        NOT NULL,           -- AES-256-GCM em nível de campo (ADR-0010)
  cpf_indice           text        NOT NULL UNIQUE,    -- HMAC para unicidade sem expor o CPF
  numero_oab           text        UNIQUE,             -- só para advogados (D1)
  email_verificado_em  timestamptz,
  falhas_login         int         NOT NULL DEFAULT 0,
  bloqueado_ate        timestamptz,
  criado_em            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tokens_verificacao_email (
  token_hash  text PRIMARY KEY,                       -- SHA-256 do token; o token em si nunca é guardado
  usuario_id  uuid        NOT NULL REFERENCES usuarios(id),
  expira_em   timestamptz NOT NULL,
  usado_em    timestamptz
);

-- Refresh tokens opacos e rotativos, agrupados por família (ADR-0005)
CREATE TABLE refresh_tokens (
  id              uuid PRIMARY KEY,
  familia_id      uuid        NOT NULL,
  usuario_id      uuid        NOT NULL REFERENCES usuarios(id),
  token_hash      text        NOT NULL UNIQUE,
  expira_em       timestamptz NOT NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  substituido_por uuid,
  revogado_em     timestamptz
);
CREATE INDEX refresh_tokens_familia ON refresh_tokens (familia_id);

-- Par de chaves assimétricas do JWT. A chave privada é guardada cifrada.
CREATE TABLE chaves_jwt (
  kid             text PRIMARY KEY,
  privada_cifrada text        NOT NULL,
  publica_jwk     jsonb       NOT NULL,
  ativa           boolean     NOT NULL DEFAULT true,
  criada_em       timestamptz NOT NULL DEFAULT now()
);
