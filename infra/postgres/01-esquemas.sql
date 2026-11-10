-- ADR-0010: uma instância PostgreSQL, um esquema por serviço, um usuário de banco por serviço
-- com permissão apenas no próprio esquema. Sem joins entre esquemas.
-- Senhas abaixo são apenas para o ambiente de desenvolvimento (docker compose).

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE veridit FROM PUBLIC;

CREATE USER identidade_app  WITH PASSWORD 'identidade_dev';
CREATE USER creditos_app    WITH PASSWORD 'creditos_dev';
CREATE USER registros_app   WITH PASSWORD 'registros_dev';
CREATE USER evidencias_app  WITH PASSWORD 'evidencias_dev';
CREATE USER auditoria_app   WITH PASSWORD 'auditoria_dev';

GRANT CONNECT ON DATABASE veridit TO identidade_app, creditos_app, registros_app, evidencias_app, auditoria_app;

CREATE SCHEMA identidade AUTHORIZATION identidade_app;
CREATE SCHEMA creditos   AUTHORIZATION creditos_app;
CREATE SCHEMA registros  AUTHORIZATION registros_app;
CREATE SCHEMA evidencias AUTHORIZATION evidencias_app;
CREATE SCHEMA auditoria  AUTHORIZATION auditoria_app;

-- Cada usuário enxerga só o próprio esquema por padrão
ALTER USER identidade_app SET search_path = identidade;
ALTER USER creditos_app   SET search_path = creditos;
ALTER USER registros_app  SET search_path = registros;
ALTER USER evidencias_app SET search_path = evidencias;
ALTER USER auditoria_app  SET search_path = auditoria;
