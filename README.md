# Veridit — Trabalho III (Engenharia de Software I, UFBA)

Implementação de **6 dos 16 requisitos (37,5%)** do Veridit, plataforma que registra conteúdo da web
(capturas de tela feitas num navegador isolado no servidor) como evidência selada com hash,
assinatura digital e carimbo do tempo.

A implementação segue a arquitetura definida por outra equipe no Trabalho II:
[cauaalmeida01/projeto2](https://github.com/cauaalmeida01/projeto2) (documento arquitetural e ADRs 0001–0010).

| Documento | Conteúdo |
|---|---|
| [docs/requisitos-sprint1.md](docs/requisitos-sprint1.md) | Requisitos implementados nesta sprint, critérios de aceite e o que ficou para a próxima |
| [docs/arquitetura-implementada.md](docs/arquitetura-implementada.md) | Como cada ADR foi implementada, desvios e pontos a registrar em ADR |
| [docs/solid.md](docs/solid.md) | Onde cada princípio SOLID foi aplicado e por quê |
| [docs/telas-implementadas/](docs/telas-implementadas/) | Capturas das telas, geradas pelo teste em navegador real |

---

## Como rodar

### Pré-requisitos

- **Docker Desktop** (ou Docker Engine + Compose v2) em execução, com ~6 GB de memória disponíveis.
- **Acesso à internet** (imagens Docker, sites capturados, servidor NTP e autoridade de carimbo do tempo).
- Opcional, só para rodar os testes fora do Docker: **Node.js 20+** e **Python 3**.

### Subir o sistema

```bash
git clone https://github.com/g-barreto00/veridit.git
cd veridit
docker compose up -d --build        # primeira vez: alguns minutos (baixa e constrói as imagens)
./scripts/criar-conta-demo.sh       # cria a conta demo@veridit.dev / Veridit2026, já confirmada
```

Abra **http://localhost:5173** no **Chrome** e entre com `demo@veridit.dev` / `Veridit2026`.

> Use `localhost` (não o IP da máquina). O cookie de sessão é `Secure`, e o navegador só o aceita
> em HTTP puro quando o endereço é `localhost`; fora disso, recarregar a página desloga.

| Endereço | O quê |
|---|---|
| http://localhost:5173 | Aplicação web |
| http://localhost:8025 | Mailpit — caixa de e-mail de teste (links de confirmação de cadastro) |
| http://localhost:15672 | Painel do RabbitMQ (usuário `veridit`, senha `veridit_dev`) |
| http://localhost:8080/api | API Gateway |

### Roteiro de demonstração

1. **Criar conta** (REQ01): escolha Advogado ou Usuário comum, informe um CPF válido e aceite os termos.
   O e-mail de confirmação chega no **Mailpit** (http://localhost:8025); clique no link.
2. **Entrar** (REQ03). A conta nova tem 5 créditos de boas-vindas.
3. **Novo registro** (REQ08): informe um site e um título → *Iniciar registro*.
4. **Sessão de captura**: o site abre num Chromium isolado no servidor e aparece ao vivo na tela.
   Navegue, role, clique, e use **Capturar tela** quantas vezes quiser (REQ11). O painel mostra IP,
   DNS, certificado TLS e horário NTP de cada captura. **Concluir registro** encerra a sessão.
5. **Selagem** (ADR-0004): em poucos segundos o registro fica *Concluído*, com hash, assinatura e
   carimbo do tempo conferidos, e o crédito é consumido.
6. **Meus registros** (REQ12): busca, filtros e status. **Sair** (REQ04).

### Desligar

```bash
docker compose down        # para tudo e mantém os dados do banco
docker compose down -v     # para tudo e apaga os dados (recomeça do zero)
```

O S3 é emulado pelo LocalStack gratuito, que **não guarda arquivos entre reinícios**: as imagens e
evidências seladas antes de um `down` deixam de existir (os registros continuam no banco).

---

## Testes

Com o sistema no ar (`docker compose up -d`):

```bash
npm install                          # uma vez
npm test --workspaces --if-present   # 66 testes de unidade e integração (PostgreSQL e RabbitMQ reais)

./scripts/e2e.sh                     # API: cadastro, e-mail, login, segurança do gateway, créditos,
                                     #      registros, renovação e logout (35 cenários)
node scripts/e2e-sessao.mjs          # sessão interativa via WebSocket, captura, selagem e verificação
./scripts/teste-isolamento.sh        # ADR-0003: o navegador de captura não alcança a rede interna
./scripts/e2e-web.sh                 # interface em navegador real (Playwright), salva as telas
```

Destaques:

- **ADR-0008 (conformidade):** 20 reservas simultâneas com saldo para 1 resultam em exatamente 1 sucesso.
- **ADR-0004:** o pacote selado é verificável **fora da plataforma** só com `openssl`
  (instruções no `VERIFICACAO.txt` gravado junto de cada evidência); alterar 1 byte é detectado.
- **ADR-0003:** o contêiner do navegador não alcança PostgreSQL, RabbitMQ, Redis nem os serviços,
  nem pelo IP, nem pelo proxy de saída (`localhost`, `127.0.0.1.nip.io`, `169.254.169.254`, `[::1]`…).
- **ADR-0002:** a imagem do worker de captura não contém driver nem credenciais de banco.

---

## Arquitetura (resumo)

Estilo **baseado em serviços** com mensageria assíncrona (ADR-0002):

```
 Navegador ──► web (nginx) ──► gateway ──┬─► identidade ─────────────┐
   (React)        :5173      JWT/JWKS,   ├─► creditos (carteira)     │  PostgreSQL
                             revogação,  ├─► registros (saga) ───────┤  (um esquema por serviço)
                             WebSocket   ├─► evidencias (selagem) ───┘
                                         │
                      RabbitMQ ◄─────────┴── outbox ── eventos ── notificacoes ──► Mailpit
                          │
                          ▼
              captura × 2 (workers) ──► navegador efêmero por sessão ──► proxy-saida ──► internet
                          │                (rede-captura, sem rota interna)
                          ▼
              LocalStack: S3 (temporário e WORM com Object Lock) + KMS (assinatura)
```

| Pasta | Componente (documento arquitetural) |
|---|---|
| `web/` | C01 Aplicação Web |
| `servicos/gateway/` | C02 API Gateway |
| `servicos/identidade/` | C03 Cadastro, C04 Autenticação e Sessão |
| `servicos/creditos/` | C09 Carteira de Créditos (C06/C07/C08 na próxima sprint) |
| `servicos/registros/` | C10 Gestão de Registros, C11 Orquestrador de Captura |
| `servicos/captura/` | C12 Motor de Captura |
| `servicos/evidencias/` | C13 Selagem, C14 Repositório de Evidências |
| `servicos/notificacoes/` | C17 Notificações (verificação de e-mail) |
| `compartilhado/contratos/` | Eventos versionados e topologia das filas |
| `compartilhado/mensageria/` | Outbox, consumidor idempotente, retentativas e DLQ (ADR-0007) |
| `compartilhado/plataforma/` | Configuração, migrações e criptografia de campo (ADR-0010) |
| `infra/` | Banco, LocalStack, imagem do navegador e proxy de saída |

**Tecnologias:** Node.js 22, TypeScript, NestJS, React + Vite, PostgreSQL 16, RabbitMQ, Redis,
Playwright/Chromium, LocalStack (S3 e KMS), FreeTSA (RFC 3161), Docker Compose. Pela premissa P5 do
documento arquitetural, as tecnologias citadas lá são exemplos substituíveis por equivalentes.

---

## Uso de ferramentas de IA

A equipe está na condição **com ferramentas de IA** no Trabalho III. O código foi desenvolvido com
apoio do Claude Code; as decisões foram avaliadas e assumidas pela equipe. ADRs não foram criadas
nem alteradas fora das sessões em sala.

## Equipe

<!-- Preencher com os nomes da equipe. -->
- Gabriel Barreto
