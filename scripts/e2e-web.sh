#!/usr/bin/env bash
# Teste da interface em navegador real. Pré-requisito: docker compose up -d
# As capturas de cada tela ficam em ./docs/telas-implementadas/
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p docs/telas-implementadas
docker run --rm --network veridit_rede-interna \
  -e NODE_PATH=/usr/lib/node_modules -e SAIDA=/saida -e URL_ALVO="${1:-https://example.com/}" \
  -v "$PWD/scripts/e2e-web.mjs:/teste/e2e-web.mjs:ro" \
  -v "$PWD/docs/telas-implementadas:/saida" \
  --user root veridit-navegador:1.64.1 node /teste/e2e-web.mjs
