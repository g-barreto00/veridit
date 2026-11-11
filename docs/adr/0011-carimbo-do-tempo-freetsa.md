# ADR-0011: Obter o carimbo do tempo do FreeTSA no lugar de uma ACT credenciada na ICP-Brasil

- **Status:** Aceita. Substitui parcialmente a [ADR-0004](https://github.com/cauaalmeida01/projeto2/blob/main/docs/arquitetura/adr/0004-selagem-das-evidencias.md), somente no passo 4 (autoridade do carimbo do tempo)
- **Data:** 2026-11-10
- **Decisores:** Daniel Santana, Davi Guimarães, Gabriel Barreto e Leone de Castro (equipe implementadora)
- **De acordo da equipe autora da arquitetura:** Cauã Marinho, João Ferraz, Guilherme Loiola e Davi Araújo. Concordância dada em sala, na sessão supervisionada de 2026-11-10, por <!-- nome do integrante da equipe autora presente -->
- **Características arquiteturais relacionadas:** Integridade e autenticidade das evidências (ADR-0001), Custo, Interoperabilidade
- **Requisitos e restrições relacionados:** REQ11 (concluir captura de tela), REQ09 (concluir gravação; próxima sprint), REQ14 e REQ15 (relatório e .zip com o carimbo; próxima sprint); restrição do projeto: trabalho acadêmico, sem orçamento para contratar serviços

## Contexto

A ADR-0004 define a selagem das evidências em seis passos. O passo 4 diz:

> Obter um **carimbo do tempo** (RFC 3161) de uma Autoridade de Carimbo do Tempo credenciada na ICP-Brasil
> sobre o hash do manifesto.

O carimbo prova a terceiros que o manifesto (e, por ele, cada arquivo capturado) já existia num determinado
instante. Sem ele, a plataforma só consegue afirmar a data por conta própria, o que enfraquece a evidência.

Na implementação (Trabalho III), as Autoridades de Carimbo do Tempo credenciadas na ICP-Brasil se mostraram
inviáveis: o serviço é pago, exige contrato e credenciais, e não oferece ambiente de testes aberto. Sem uma
autoridade, o passo 4 não pode ser executado, e pela própria ADR-0004 nenhum registro chegaria a "Concluído".

## Decisão

Vamos obter o carimbo do tempo do **FreeTSA** (https://freetsa.org/tsr), uma autoridade pública e gratuita que
segue a **RFC 3161**, no lugar de uma ACT credenciada na ICP-Brasil.

- O carimbo continua sendo pedido **sobre o SHA-256 do manifesto**, como na ADR-0004.
- A resposta (`manifesto.tsr`) é conferida antes de aceita (status, hash carimbado igual ao enviado) e gravada
  no armazenamento imutável junto com o manifesto e a assinatura.
- O endereço da autoridade é **configuração** (`URL_CARIMBO_TEMPO`), atrás da porta `CarimboTempo`. Voltar para
  uma ACT ICP-Brasil exige só trocar a URL, e o adaptador caso a ACT use autenticação. O caso de uso de selagem
  não muda.
- Os demais passos da ADR-0004 (hash, manifesto, assinatura no KMS, WORM, custódia) não mudam.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| ACT credenciada na ICP-Brasil (decisão original) | Presunção de validade jurídica no Brasil | Paga, exige contrato e credenciais; inviável para o projeto acadêmico |
| **FreeTSA (RFC 3161)** | Gratuito, público, mesmo protocolo e formato; verificável com `openssl ts -verify` e a cadeia de certificados publicada pela autoridade | Não é credenciado na ICP-Brasil; serviço sem garantia de disponibilidade (SLA) |
| Outras TSAs públicas (ex.: DigiCert, Sectigo) | Gratuitas, RFC 3161 | Também fora da ICP-Brasil; sem vantagem sobre o FreeTSA para o projeto |
| Carimbo emitido pela própria plataforma | Sem dependência externa | Não prova nada a terceiros: é a plataforma atestando a si mesma, exatamente o que a ADR-0004 quer evitar |
| Omitir o carimbo nesta etapa | Mais simples | Enfraquece a integridade (top 2 da ADR-0001); contraria a ADR-0004, que exige o carimbo antes de "Concluído" |

## Justificativa

A integridade e a autenticidade das evidências é a segunda característica prioritária (ADR-0001). O que a
torna verificável por terceiros é o carimbo emitido por **uma parte independente da plataforma**, num formato
padronizado. O FreeTSA preserva essas duas propriedades: é independente e segue a RFC 3161. O que se perde é o
reconhecimento formal da ICP-Brasil, que depende de contratação, não de arquitetura.

Por manter o mesmo protocolo e isolar a autoridade atrás de uma porta, a decisão é reversível com custo mínimo
quando houver orçamento.

## Consequências

**Positivas**

- A selagem completa da ADR-0004 funciona, e o registro chega a "Concluído" com carimbo de terceiro.
- O pacote é verificável fora da plataforma com ferramentas comuns (`openssl ts -verify`), conforme o
  `VERIFICACAO.txt` gravado com cada evidência.
- Trocar de autoridade é configuração.

**Negativas / trade-offs**

- O carimbo não tem a presunção de validade da ICP-Brasil; em uso real com advogados (D1), a força probatória
  é menor.
- Dependência de um serviço gratuito sem SLA.

**Riscos**

- Indisponibilidade do FreeTSA impede a selagem. Mitigação: até 5 tentativas com espera crescente (ADR-0007);
  após isso, `SelagemFalhou` e estorno da reserva de créditos (saga), sem perda de crédito do usuário.
- Mudança de política do FreeTSA. Mitigação: a autoridade é configurável.

## Conformidade

- Teste de unidade com uma resposta real do FreeTSA (`servicos/evidencias/test/fixtures/freetsa-teste.tsr`):
  confere status, hash carimbado e horário.
- O teste ponta a ponta (`scripts/e2e-sessao.mjs`) exige "carimbo do tempo confere com o manifesto" em cada
  registro concluído.
- A verificação de cada evidência (`GET /api/evidencias/:registroId`) recalcula o hash do manifesto e confere
  com o hash carimbado.

## Notas

- Histórico: registro criado em 2026-11-10, na sessão supervisionada, com o de acordo da equipe autora.
- ADRs relacionadas: ADR-0004 (substituída parcialmente, só no passo 4), ADR-0001 (integridade), ADR-0007
  (retentativas e saga).
- A ADR-0004 continua sendo do repositório da equipe autora; cabe a ela anotar lá a substituição parcial por
  esta ADR.
- Elaborada em sala com apoio de ferramenta de IA (Claude Code), em 2026-11-10; a equipe avaliou e assume a
  decisão. Registro da interação: <!-- local do registro da interação com IA -->.
