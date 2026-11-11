# Arquitetura implementada × arquitetura definida

Arquitetura de referência: [cauaalmeida01/projeto2](https://github.com/cauaalmeida01/projeto2), ADRs 0001–0010.

O enunciado pede que desvios da arquitetura sejam comprovados com ADRs e com o "de acordo" da equipe que a
definiu. Pelas regras da disciplina, **ADRs só são criadas ou alteradas em sala, nas sessões supervisionadas**.
Este documento registra como cada ADR foi implementada e lista os pontos levados à sessão. Ele não substitui as ADRs.

## Situação por ADR

| ADR | Decisão | Situação na implementação |
|---|---|---|
| 0001 | Top 4: segurança, integridade, confiabilidade, escalabilidade | Seguida. Cada característica tem teste automatizado (ver README, "Testes") |
| 0002 | Estilo baseado em serviços com mensageria assíncrona | Seguida: Identidade, Créditos, Registros, Captura, Evidências e Notificações separados, com API Gateway, REST síncrono e eventos assíncronos. Auditoria fica para a próxima sprint |
| 0003 | Captura em navegador remoto isolado no servidor | Seguida, com **sessão interativa** (screencast + mouse/teclado por WebSocket) e um contêiner Chromium efêmero por sessão (opção "b", combinada com a equipe autora: navegador em contêiner separado do worker) |
| 0004 | SHA-256, manifesto assinado, carimbo do tempo, WORM, custódia | Seguida, exceto a autoridade de carimbo (**desvio 1**, [ADR-0011](adr/0011-carimbo-do-tempo-freetsa.md)) |
| 0005 | JWT curto + refresh revogável; Argon2id | Seguida integralmente, inclusive verificação de e-mail e bloqueio progressivo |
| 0006 | Pagamentos via Mercado Pago | Próxima sprint (REQ05–REQ07 fora do escopo) |
| 0007 | Outbox, filas duráveis, DLQ, saga | Seguida: outbox transacional, consumidores idempotentes, retentativas com backoff, DLQ e saga orquestrada pelo Registros |
| 0008 | Carteira como livro-razão com reserva | Seguida: lançamentos só de inserção, reserva/consumo/estorno idempotentes, concorrência otimista, expiração de reservas e verificador de invariantes |
| 0009 | Workers de captura sem estado com autoescalonamento | Seguida no modo de desenvolvimento previsto na própria ADR (Docker Compose com réplicas fixas, prefetch 1, até 2 sessões por usuário) |
| 0010 | PostgreSQL com esquema por serviço + armazenamento de objetos | Seguida: um esquema e um usuário de banco por serviço, sem acesso cruzado (testado), CPF cifrado em nível de campo, buckets separados |

## Desvios

### Desvio 1 — Carimbo do tempo pelo FreeTSA (ADR-0004)

- **ADR:** carimbo RFC 3161 de uma Autoridade de Carimbo do Tempo credenciada na ICP-Brasil.
- **Implementado:** carimbo RFC 3161 do **FreeTSA** (freetsa.org), que não é credenciado na ICP-Brasil.
- **Motivo:** o serviço credenciado é pago e exige contratação.
- **Impacto:** o formato e a verificação são os mesmos (`openssl ts -verify`). Trocar a autoridade é mudar a
  variável `URL_CARIMBO_TEMPO`.
- **Situação:** registrado na [ADR-0011](adr/0011-carimbo-do-tempo-freetsa.md) (Aceita, 2026-11-10), em sala, com o de acordo da equipe autora. Substitui parcialmente a ADR-0004, só no passo 4.

## Equivalências tecnológicas (premissa P5 do documento: tecnologias são exemplos)

| Na ADR | Implementado | Observação |
|---|---|---|
| KMS/HSM (ADR-0004) | KMS emulado pelo LocalStack | Chave nunca exportada; mesma API da AWS. Combinado com a equipe autora |
| S3 com Object Lock (ADR-0004, 0010) | S3 emulado pelo LocalStack | O MinIO deixou de ser publicado no Docker Hub. O LocalStack gratuito não guarda arquivos entre reinícios |
| Kubernetes + KEDA (ADR-0009) | Docker Compose com 2 réplicas | Previsto na própria ADR para desenvolvimento |
| RabbitMQ, PostgreSQL, Playwright | Os mesmos | — |

## Decisões de implementação (sem ADR)

Não são desvios da decisão, mas de forma ou de leitura de um item de Conformidade. Foram apresentados na
sessão em sala de 2026-11-10; a equipe decidiu registrar em ADR apenas o desvio 1 (ADR-0011) e manter estes
pontos documentados aqui.

1. **Verificador de Origem (Conformidade da ADR-0003 cita mTLS).** Implementado com HMAC-SHA256 do evento
   `CapturaConcluida`, com uma chave compartilhada só entre workers de captura e o serviço de Evidências, e com o
   SHA-256 de cada arquivo calculado na captura e conferido na selagem. A garantia é a mesma: só um worker
   autêntico faz o Evidências aceitar arquivos, e alteração no bucket temporário é detectada.
2. **Proxy de saída da rede de captura (ADR-0003).** O teste de conformidade mostrou que, no Docker Desktop,
   um contêiner numa rede bridge alcançava pelo IP serviços de outra rede. A rede dos navegadores passou a ser
   `internal`, e a única saída é um proxy que recusa destinos privados, loopback e link-local. É a forma de
   cumprir "sem acesso à rede interna".
3. **Pacotes compartilhados (Conformidade da ADR-0002: "só o pacote `compartilhado/contratos`").** Além de
   `contratos`, há duas bibliotecas técnicas sem regra de negócio: `mensageria` (outbox, consumidor) e
   `plataforma` (configuração, migrações, criptografia de campo). Nenhum serviço importa código de outro serviço,
   que é o objetivo da regra.
4. **Sinal de vida do worker (C12).** Não implementado nesta sprint. Worker travado é tratado pelo Monitor de
   Prazos do Registros, e worker reiniciado avisa a falha na hora.
