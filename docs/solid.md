# Princípios SOLID no Veridit

Onde cada princípio foi aplicado e por quê. Atualizado a cada módulo implementado.

## Pacote `@veridit/mensageria` (ADR-0007)

| Princípio | Onde | Por quê |
|---|---|---|
| **S** — Responsabilidade única | [`OutboxPg`](../compartilhado/mensageria/src/outbox/outbox-pg.ts) só grava eventos na transação; [`RelayOutbox`](../compartilhado/mensageria/src/outbox/relay-outbox.ts) só decide *quando* publicar; [`RepositorioRelayOutboxPg`](../compartilhado/mensageria/src/outbox/outbox-pg.ts) só lê e dá baixa; [`PublicadorRabbit`](../compartilhado/mensageria/src/rabbit/publicador-rabbit.ts) só fala com o broker | Cada classe tem um motivo para mudar: trocar o banco não mexe no agendamento do relay, trocar o broker não mexe no outbox |
| **O** — Aberto/fechado | [`ConsumidorEventos`](../compartilhado/mensageria/src/rabbit/consumidor-eventos.ts) recebe um mapa `tipo → manipulador` | Um serviço passa a tratar um evento novo registrando um manipulador, sem alterar o consumidor |
| **L** — Substituição de Liskov | [`GuardaIdempotenciaPg`](../compartilhado/mensageria/src/idempotencia/guarda-pg.ts) e [`GuardaSemEstado`](../compartilhado/mensageria/src/idempotencia/guarda-sem-estado.ts) | O consumidor funciona igual com qualquer das duas: serviços com banco usam a de PostgreSQL; o worker de captura, que não acessa banco (ADR-0009), usa a sem estado |
| **I** — Segregação de interfaces | [`portas.ts`](../compartilhado/mensageria/src/portas.ts): `PublicadorEventos`, `Outbox` e `GuardaIdempotencia` separadas | O worker de captura depende só de `PublicadorEventos`; serviços de domínio dependem só de `Outbox`. Ninguém depende de métodos que não usa |
| **D** — Inversão de dependência | `RelayOutbox` depende de `PublicadorEventos` (interface), não de `PublicadorRabbit`; `ConsumidorEventos` depende de `GuardaIdempotencia` | Permite testar com dublês e trocar RabbitMQ por outro broker sem mexer nas regras de entrega |

## Serviço de Identidade e Acesso (REQ01, REQ03, REQ04; ADR-0005)

Organização em camadas: `dominio/` (regras, sem framework) → `aplicacao/` (casos de uso) → `infra/` (PostgreSQL, Argon2id, JWT) e `http/` (NestJS). Só o [`main.ts`](../servicos/identidade/src/main.ts) conhece as classes concretas.

| Princípio | Onde | Por quê |
|---|---|---|
| **S** | Um caso de uso por classe: [`CadastrarUsuario`](../servicos/identidade/src/aplicacao/cadastrar-usuario.ts), [`AutenticarUsuario`](../servicos/identidade/src/aplicacao/autenticar-usuario.ts), [`RenovarSessao`](../servicos/identidade/src/aplicacao/renovar-sessao.ts), [`EncerrarSessao`](../servicos/identidade/src/aplicacao/encerrar-sessao.ts), [`VerificarEmail`](../servicos/identidade/src/aplicacao/verificar-email.ts). A emissão do par de tokens fica isolada em [`EmissorSessao`](../servicos/identidade/src/aplicacao/emissor-sessao.ts), reaproveitada por login e renovação. A tradução erro→HTTP fica só em [`FiltroErros`](../servicos/identidade/src/http/filtro-erros.ts) | Mudar a regra de bloqueio do login não toca no cadastro; o domínio não conhece status HTTP |
| **O** | [`RegraPerfil`](../servicos/identidade/src/dominio/regras-perfil.ts) com `RegraAdvogado` e `RegraUsuarioComum`, registradas no `CatalogoPerfis` | D1 prevê empresas numa versão futura: basta criar `RegraEmpresa` e registrá-la no `main.ts`, sem alterar `CadastrarUsuario` |
| **L** | Os testes trocam [`RepositorioUsuariosPg`](../servicos/identidade/src/infra/repositorio-usuarios-pg.ts) por [`UsuariosMemoria`](../servicos/identidade/test/dubles.ts), `HasherArgon2id` por um hasher falso etc. | Os casos de uso se comportam igual com qualquer implementação que respeite o contrato da porta — é o que permite os 15 testes de unidade rodarem sem banco |
| **I** | [`portas.ts`](../servicos/identidade/src/dominio/portas.ts): `RepositorioUsuarios`, `RepositorioRefreshTokens`, `RepositorioTokensVerificacao`, `HasherSenha`, `EmissorTokenAcesso`, `GeradorTokens` separados | `EncerrarSessao` depende só de refresh tokens; `ConsultarUsuario` só de usuários. Nenhum caso de uso recebe métodos que não usa |
| **D** | Casos de uso recebem interfaces no construtor; a transação é uma interface opaca (`Transacao`/`ExecutorTransacao`) | A aplicação não importa `pg`, `jose` nem `argon2`. Trocar a chave do JWT para um KMS ou o banco para outro SGBD só afeta `infra/` |

## API Gateway (ADR-0002, ADR-0005)

| Princípio | Onde | Por quê |
|---|---|---|
| **S** | Middlewares separados em [`middlewares.ts`](../servicos/gateway/src/middlewares.ts): correlação, limite por IP, autenticação | Cada preocupação transversal muda sozinha |
| **O** | Tabela de rotas e de rotas públicas em [`rotas.ts`](../servicos/gateway/src/rotas.ts) | Novos serviços (Registros, Créditos, Evidências) entram como dados, sem alterar middlewares |
| **D** | Middlewares dependem de `ValidadorToken`, `ListaRevogacao` e `LimitadorTaxa` ([`seguranca.ts`](../servicos/gateway/src/seguranca.ts)), não de `jose`/`ioredis` | Permite trocar Redis ou o formato de token sem mexer no fluxo de autenticação |

## Serviço de Notificações

| Princípio | Onde | Por quê |
|---|---|---|
| **O** | [`ModeloEmail<E>`](../servicos/notificacoes/src/portas.ts) — um modelo por tipo de e-mail | Na sprint 2, REQ07/REQ10/REQ11-B entram como novos modelos registrados no consumidor |
| **D** | Envio pela porta `EnviadorEmail`; [`EnviadorSmtp`](../servicos/notificacoes/src/enviador-smtp.ts) é só uma implementação | Mailpit em desenvolvimento, provedor real em produção, sem alterar os modelos |

## Serviço de Créditos — Carteira (ADR-0008)

| Princípio | Onde | Por quê |
|---|---|---|
| **S** | [`Carteira`](../servicos/creditos/src/dominio/carteira.ts) só aplica lançamentos e protege as invariantes; [`UnidadeCarteira`](../servicos/creditos/src/aplicacao/unidade-carteira.ts) só cuida de transação e retentativa por conflito; [`RepositorioCarteirasPg`](../servicos/creditos/src/infra/repositorios-pg.ts) só persiste com concorrência otimista; os jobs do C09 ([`ExpirarReservas`, `VerificarInvariantes`](../servicos/creditos/src/aplicacao/manutencao.ts)) são classes próprias | A regra "saldo nunca negativo" é testada sem banco; a estratégia de concorrência pode mudar (ex.: bloqueio pessimista) sem tocar no domínio |
| **O** | Tabela `EFEITOS` em [`carteira.ts`](../servicos/creditos/src/dominio/carteira.ts) (efeito de cada tipo de lançamento) e [`PoliticaConsumo`](../servicos/creditos/src/dominio/portas.ts) configurável no banco (premissa P3) | Um novo tipo de registro (ex.: vídeo longo) é só uma linha em `politica_consumo`; um novo tipo de lançamento é uma entrada na tabela de efeitos |
| **L** | `ConsultaInvariantesPg` reaproveita `Carteira.saldoDosLancamentos` | A regra de cálculo do saldo existe em um único lugar, usada tanto pelo domínio quanto pelo verificador |
| **I** | Portas separadas: `RepositorioCarteiras`, `RepositorioReservas`, `PoliticaConsumo`, `ConsultaInvariantes` | `CreditarCarteira` não depende de reservas; `VerificarInvariantes` só depende da consulta |
| **D** | Casos de uso recebem as portas; a montagem fica em [`composicao.ts`](../servicos/creditos/src/composicao.ts), usada pelo `main` e pelos testes de integração | Os testes trocam o relógio por um ajustável para simular expiração de reservas |

## Serviço de Registros — Gestão (C10) e Orquestrador de Captura (C11)

| Princípio | Onde | Por quê |
|---|---|---|
| **S** | [`Registro`](../servicos/registros/src/dominio/registro.ts) só conhece a máquina de estados do diagrama c11-estados; [`IniciarRegistro`](../servicos/registros/src/aplicacao/iniciar-registro.ts) só o início da saga; [`CoordenadorSaga`](../servicos/registros/src/aplicacao/coordenador-saga.ts) só as reações a eventos, cancelamento e prazos; [`ConsultarRegistros`](../servicos/registros/src/aplicacao/consultar-registros.ts) só leitura (REQ12) | A regra "não se pode cancelar enquanto sela" está num único lugar (tabela `TRANSICOES`) e é testada sem banco |
| **O** | Tabela `TRANSICOES` e `PRAZOS_MS` em [`registro.ts`](../servicos/registros/src/dominio/registro.ts); `TIPOS_HABILITADOS` em `IniciarRegistro` | Habilitar o vídeo (REQ09, sprint 2) é acrescentar `'VIDEO'` à lista; um novo estado é uma entrada na tabela |
| **L** | [`ClienteCarteiraHttp`](../servicos/registros/src/infra/cliente-carteira-http.ts) e `CarteiraFalsa` (teste); [`AlocadorSessaoRedis`](../servicos/registros/src/infra/alocador-sessao-redis.ts) e `AlocadorFalso` | A saga se comporta igual com o cliente HTTP real ou com o dublê; os 11 testes de integração exercitam a saga inteira sem subir o serviço de Créditos |
| **I** | `CarteiraCreditos` expõe só `reservar/consumir/estornar`; `AlocadorSessao` só `registrar/remover` ([`portas.ts`](../servicos/registros/src/dominio/portas.ts)) | Registros não depende de saldo, extrato ou de qualquer outra operação da Carteira |
| **D** | Saga e casos de uso dependem das portas; [`composicao.ts`](../servicos/registros/src/composicao.ts) recebe carteira e alocador por parâmetro | A chamada síncrona à Carteira (ADR-0008) poderia virar mensageria sem alterar a saga |
