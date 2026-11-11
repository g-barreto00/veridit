#!/usr/bin/env bash
# Cria (ou recria) a conta de demonstração, já com o e-mail confirmado.
# Uso: ./scripts/criar-conta-demo.sh [email] [senha]      Pré-requisito: docker compose up -d
set -euo pipefail
GW=${GW:-http://localhost:8080}
MAILPIT=${MAILPIT:-http://localhost:8025}
EMAIL=${1:-demo@veridit.dev}
SENHA=${2:-Veridit2026}
CPF=$(python3 -c '
import random
d=[random.randint(0,9) for _ in range(9)]
for p in (10,11):
    r=(sum(v*(p-i) for i,v in enumerate(d))*10)%11; d.append(0 if r==10 else r)
print("".join(map(str,d)))')
OAB="BA $((RANDOM % 900000 + 1000))"

status=$(curl -s -o /tmp/cadastro.json -w '%{http_code}' -X POST "$GW/api/auth/cadastro" -H 'content-type: application/json' \
  -d "{\"perfil\":\"ADVOGADO\",\"nome\":\"Ana Souza Demo\",\"email\":\"$EMAIL\",\"senha\":\"$SENHA\",\"cpf\":\"$CPF\",\"numeroOab\":\"$OAB\"}")
if [[ "$status" == "409" ]]; then echo "A conta $EMAIL já existe."; exit 0; fi
[[ "$status" == "201" ]] || { echo "Falha no cadastro ($status): $(cat /tmp/cadastro.json)"; exit 1; }

for _ in $(seq 1 20); do
  ID=$(curl -s "$MAILPIT/api/v1/search?query=to:$EMAIL" | python3 -c 'import sys,json; m=json.load(sys.stdin)["messages"]; print(m[0]["ID"] if m else "")')
  [[ -n "$ID" ]] && break; sleep 0.5
done
TOKEN=$(curl -s "$MAILPIT/api/v1/message/$ID" | python3 -c 'import sys,json,re,urllib.parse; print(urllib.parse.unquote(re.search(r"token=(\S+)", json.load(sys.stdin)["Text"]).group(1)))')
curl -s -o /dev/null -X POST "$GW/api/auth/verificar-email" -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\"}"
echo "Conta pronta: $EMAIL / $SENHA  →  http://localhost:5173"
