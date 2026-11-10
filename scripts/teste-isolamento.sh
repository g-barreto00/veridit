#!/usr/bin/env bash
# Conformidade da ADR-0003: "o contêiner de captura não alcança endereços da rede interna".
# Sobe um contêiner na rede-captura (como os navegadores efêmeros) e tenta alcançar os serviços
# internos diretamente e pelo proxy de saída. Pré-requisito: docker compose up -d
set -uo pipefail
cd "$(dirname "$0")/.."
REDE=veridit-rede-captura
IMG=veridit-navegador:1.64.1
falhas=0
ipde() { docker inspect -f '{{(index .NetworkSettings.Networks "veridit_rede-interna").IPAddress}}' "veridit-$1-1"; }

echo "1) Conexão direta (esperado: bloqueado)"
ALVOS=()
for s in postgres:5432 rabbitmq:5672 redis:6379 localstack:4566 gateway:8080 identidade:3001 creditos:3002 registros:3003; do
  ALVOS+=("$(ipde "${s%%:*}"):${s##*:}" "$s")
done
ALVOS+=("1.1.1.1:443")
saida=$(docker run --rm --network $REDE -v "$PWD/scripts/apoio/conectar.js:/t.js:ro" $IMG node /t.js "${ALVOS[@]}")
echo "$saida"
grep -q "ALCANÇÁVEL" <<<"$saida" && { echo "  FALHA: algum destino foi alcançado"; falhas=$((falhas+1)); }

echo "2) Pelo proxy de saída (esperado: 403 para internos, 200 para site público)"
proxy() { docker run --rm --network $REDE curlimages/curl:8.11.1 -s -o /dev/null -m 10 -w '%{http_code}' -x http://proxy-saida:3128 "$1"; }
for alvo in "http://$(ipde postgres):5432/" "http://$(ipde gateway):8080/api/saude" "http://$(ipde redis):80/" \
            "http://localhost/" "http://127.0.0.1.nip.io/" "http://169.254.169.254/latest/meta-data/" "http://[::1]/"; do
  r=$(proxy "$alvo"); printf '  %-45s %s\n' "$alvo" "$r"
  [[ "$r" == "403" ]] || { echo "  FALHA: esperado 403"; falhas=$((falhas+1)); }
done
r=$(proxy "https://example.com/"); printf '  %-45s %s\n' "https://example.com/" "$r"
[[ "$r" == "200" ]] || { echo "  FALHA: site público deveria passar"; falhas=$((falhas+1)); }

echo "3) Worker exige token de sessão (esperado: 403)"
W=$(docker inspect -f '{{(index .NetworkSettings.Networks "veridit-rede-captura").IPAddress}}' veridit-captura-1)
r=$(docker run --rm --network $REDE curlimages/curl:8.11.1 -s -o /dev/null -m 5 -w '%{http_code}' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGVzdGU=' \
  "http://$W:7000/sessoes/00000000-0000-0000-0000-000000000000/ws")
echo "  worker $W:7000 sem token → $r"; [[ "$r" == "403" ]] || falhas=$((falhas+1))

echo; [[ $falhas -eq 0 ]] && echo "Isolamento OK." || { echo "$falhas verificação(ões) falharam."; exit 1; }
