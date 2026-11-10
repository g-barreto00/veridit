-- Esquema `evidencias` (ADR-0010): evidências seladas (C13/C14) e cadeia de custódia (ADR-0004).

CREATE TABLE evidencias (
  registro_id           uuid PRIMARY KEY,
  usuario_id            uuid        NOT NULL,
  url_inicial           text        NOT NULL,
  inicio_captura        timestamptz NOT NULL,
  fim_captura           timestamptz NOT NULL,
  hash_manifesto        text        NOT NULL,   -- SHA-256 do manifesto canônico
  assinatura            text        NOT NULL,   -- assinatura do manifesto (base64, DER)
  chave_assinatura      text        NOT NULL,   -- id da chave no KMS
  algoritmo_assinatura  text        NOT NULL,
  carimbo_horario       timestamptz NOT NULL,   -- genTime do carimbo RFC 3161
  carimbo_tsa           text        NOT NULL,
  prefixo_worm          text        NOT NULL,   -- pasta no bucket com Object Lock
  versoes_worm          jsonb       NOT NULL,   -- chave → VersionId de cada objeto selado
  quantidade_imagens    int         NOT NULL,
  quantidade_videos     int         NOT NULL,
  selada_em             timestamptz NOT NULL
);
CREATE INDEX evidencias_usuario ON evidencias (usuario_id);

CREATE TABLE arquivos_evidencia (
  registro_id    uuid        NOT NULL REFERENCES evidencias(registro_id),
  nome           text        NOT NULL,
  tipo           text        NOT NULL,
  tamanho_bytes  bigint      NOT NULL,
  sha256         text        NOT NULL,
  capturado_em   timestamptz NOT NULL,
  url            text        NOT NULL,
  chave_worm     text        NOT NULL,
  versao_worm    text        NOT NULL,   -- a versão exata gravada (protegida pelo Object Lock)
  PRIMARY KEY (registro_id, nome)
);

-- Cadeia de custódia: trilha somente de inserção com encadeamento de hashes. Cada entrada
-- guarda o hash da anterior; alterar ou remover qualquer linha quebra a cadeia daí em diante.
CREATE TABLE custodia (
  id             bigserial PRIMARY KEY,
  registro_id    uuid        NOT NULL,
  etapa          text        NOT NULL,
  detalhes       jsonb       NOT NULL,
  em             timestamptz NOT NULL,
  hash_anterior  text        NOT NULL,
  hash           text        NOT NULL UNIQUE
);
CREATE INDEX custodia_registro ON custodia (registro_id, id);
CREATE RULE custodia_sem_update AS ON UPDATE TO custodia DO INSTEAD NOTHING;
CREATE RULE custodia_sem_delete AS ON DELETE TO custodia DO INSTEAD NOTHING;
CREATE RULE evidencias_sem_delete AS ON DELETE TO evidencias DO INSTEAD NOTHING;
CREATE RULE arquivos_sem_update AS ON UPDATE TO arquivos_evidencia DO INSTEAD NOTHING;
CREATE RULE arquivos_sem_delete AS ON DELETE TO arquivos_evidencia DO INSTEAD NOTHING;
