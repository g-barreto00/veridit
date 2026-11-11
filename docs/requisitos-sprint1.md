# Requisitos implementados — Sprint 1 (Trabalho III)

Documento de requisitos de referência: [veridit-req.md](https://github.com/cauaalmeida01/projeto2/blob/main/docs/requisitos/veridit-req.md)
(versão 01.00, REQ01–REQ15). O documento tem **16 requisitos funcionais**, porque o número REQ11 aparece
duas vezes: "Concluir captura de tela" e "Confirmar captura de tela por e-mail", aqui chamado de REQ11-B.

## Escopo da sprint: 6 de 16 requisitos (37,5%)

| # | Requisito | Prioridade | Situação |
|---|---|---|---|
| REQ01 | Cadastrar usuário | Alta | **Implementado** |
| REQ03 | Logar no sistema | Alta | **Implementado** |
| REQ04 | Sair do sistema | Alta | **Implementado** |
| REQ08 | Iniciar registro de conteúdo | Alta | **Implementado** (captura de tela; o vídeo entra com o REQ09) |
| REQ11 | Concluir captura de tela | Alta | **Implementado** |
| REQ12 | Listar registros realizados | Alta | **Implementado** |

**Critério da escolha:** uma fatia vertical que pudesse ser demonstrada de ponta a ponta (cadastrar → entrar →
registrar → capturar → selar → listar → sair) e que exercitasse as quatro características prioritárias da ADR-0001
(segurança, integridade das evidências, confiabilidade e escalabilidade). A sessão interativa de captura
(ADR-0003), componente de maior risco técnico, foi feita já nesta sprint, para a próxima etapa (70%) apenas
estendê-la para vídeo.

---

## Detalhamento

### REQ01 — Cadastrar usuário

*O sistema deve permitir o cadastro de usuários com os campos do Apêndice A.* (D1: advogados e usuários comuns)

- Campos: nome completo, e-mail, senha, CPF e, para advogados, número da OAB (Apêndice A).
- Perfis: advogado e usuário comum. Empresa aparece como "em breve" (D1); o cadastro está preparado para
  receber esse perfil como uma nova regra (`RegraPerfil`).
- Validações: CPF pelos dígitos verificadores; OAB no formato `UF número`; e-mail; senha com no mínimo 10
  caracteres, com letras e números (tela 02); CPF, e-mail e OAB únicos.
- Segurança (ADR-0005, ADR-0010): senha guardada com Argon2id; CPF cifrado (AES-256-GCM) no banco;
  **confirmação de e-mail obrigatória** antes do primeiro login.
- Tela: 02 Criar conta. Código: [`servicos/identidade`](../servicos/identidade/src/aplicacao/cadastrar-usuario.ts).

### REQ03 — Logar no sistema

- Login com e-mail e senha; mesma mensagem para e-mail inexistente e senha errada.
- Sessão (ADR-0005): token de acesso JWT (ES256) de 15 min, guardado só em memória na aplicação; refresh token
  opaco, rotativo, de 7 dias, em cookie `HttpOnly`/`Secure`/`SameSite=Strict`; reuso de refresh token já
  trocado revoga toda a sessão.
- Proteção contra força bruta: bloqueio progressivo após 5 falhas seguidas e limite de tentativas por IP.
- Tela: 01 Entrar. Código: [`autenticar-usuario.ts`](../servicos/identidade/src/aplicacao/autenticar-usuario.ts),
  [`gateway`](../servicos/gateway/src/middlewares.ts).

### REQ04 — Sair do sistema

- Revoga o refresh token e coloca o token de acesso na lista de revogação do gateway até ele expirar:
  o logout tem efeito imediato, inclusive para um token copiado antes.
- Tela: botão *Sair* no cabeçalho. Código: [`encerrar-sessao.ts`](../servicos/identidade/src/aplicacao/encerrar-sessao.ts).

### REQ08 — Iniciar registro de conteúdo

*Captura de conteúdo de um site a partir dos campos do Apêndice A (endereço do site e título).*

- O usuário informa endereço e título e escolhe **captura de tela**. O vídeo de navegação aparece como
  "disponível na próxima versão" (REQ09).
- Reserva de 1 crédito (ADR-0008) e no máximo 2 registros em andamento por usuário (ADR-0009).
- A captura acontece num **navegador Chromium isolado no servidor**, um contêiner novo por sessão, sem acesso
  à rede interna (ADR-0003). O usuário vê a tela remota ao vivo e controla com mouse, rolagem e teclado.
- Telas: 10 Novo registro, 11 Sessão de captura. Código: [`servicos/registros`](../servicos/registros/src/aplicacao/iniciar-registro.ts),
  [`servicos/captura`](../servicos/captura/src/aplicacao/sessao-captura.ts).

### REQ11 — Concluir captura de tela

- Cada captura grava a tela visível (várias por registro) com os metadados técnicos: URL final, IP do servidor,
  DNS, cabeçalhos HTTP, certificado TLS e horário obtido de servidor NTP.
- Ao concluir, os arquivos são **selados** (ADR-0004): SHA-256 de cada arquivo, manifesto assinado no KMS,
  carimbo do tempo RFC 3161, armazenamento imutável (Object Lock) e cadeia de custódia. Só então o registro
  fica *Concluído* e o crédito é consumido; se algo falhar, o crédito volta.
- Telas: 11 Sessão de captura, 12 Selando a evidência. Código: [`servicos/evidencias`](../servicos/evidencias/src/aplicacao/selar-evidencia.ts).

### REQ12 — Listar registros realizados

*Campos do Apêndice A: título, data/hora início, data/hora fim, detalhes, status.*

- Lista paginada com busca por título, filtros de status e período, e contadores de concluídos e em andamento.
- Cada usuário vê só os próprios registros. A lista se atualiza sozinha enquanto há registro em andamento.
- Tela: 05 Meus registros. Código: [`consultar-registros.ts`](../servicos/registros/src/aplicacao/consultar-registros.ts).

---

## Premissas desta sprint

| Premissa | Motivo | O que muda na próxima sprint |
|---|---|---|
| Cada conta nova recebe **5 créditos de boas-vindas**, lançados como `AJUSTE` (tipo previsto na ADR-0008) | Sem a compra (REQ05/REQ06) não haveria como registrar | A compra passa a gerar `CREDITO_COMPRA`; o bônus pode ser mantido ou zerado pela variável `CREDITOS_BOAS_VINDAS` |
| Captura de tela custa **1 crédito** | Valor da tela 10; a quantidade é configurável (premissa P3 do documento arquitetural) | Vídeo: "1 crédito a cada 5 min" (tela 10) |
| E-mails só para a confirmação de cadastro | Necessária para o REQ01 (ADR-0005) | Confirmações de compra e de conclusão (REQ07, REQ10, REQ11-B) |

## Próxima sprint (70%)

| # | Requisito | Base já pronta nesta sprint |
|---|---|---|
| REQ02 | Recuperar senha | Serviço de Notificações, tokens de uso único com hash, revogação de sessões |
| REQ05 | Comprar créditos | Carteira (`CREDITO_COMPRA` já tratado no evento `PagamentoConfirmado`) |
| REQ06 | Efetuar pagamento (Mercado Pago / Pix) | Outbox, consumidor idempotente, reconciliação prevista na ADR-0006 |
| REQ07 | Confirmar pagamento por e-mail | Notificações (novo modelo de e-mail) |
| REQ09 | Concluir gravação de conteúdo (vídeo) | Sessão interativa pronta; falta ligar a gravação de vídeo e os novos comandos |
| REQ10 | Confirmar gravação por e-mail | Evento `RegistroConcluido` já publicado |
| REQ11-B | Confirmar captura de tela por e-mail | Evento `RegistroConcluido` já publicado |
| REQ13 | Visualizar detalhes do registro | Consulta de detalhes e verificação da evidência já existem na API |
| REQ14 | Gerar relatório do registro | Manifesto, metadados e hashes já selados |
| REQ15 | Gerar arquivo .zip | Pacote selado no armazenamento imutável, com instruções de verificação |
