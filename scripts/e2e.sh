#!/usr/bin/env bash
# Teste ponta a ponta pelo API Gateway: REQ01, REQ03, REQ04 e créditos (ADR-0008).
# Pré-requisito: docker compose up -d
set -uo pipefail
GW=${GW:-http://localhost:8080}
MAILPIT=${MAILPIT:-http://localhost:8025}
JAR=$(mktemp)
EMAIL="teste.$(date +%s)@exemplo.com"
# CPF válido aleatório
gerar_cpf() { python3 -c '
import random
d=[random.randint(0,9) for _ in range(9)]
for p in (10,11):
    s=sum(v*(p-i) for i,v in enumerate(d)); r=(s*10)%11; d.append(0 if r==10 else r)
print("".join(map(str,d)))'; }
CPF=$(gerar_cpf)
OAB="BA $((RANDOM % 900000 + 1000))"
falhas=0
verificar() { # nome esperado obtido
  if [[ "$2" == "$3" ]]; then echo "  ok   $1 ($3)"; else echo "  FALHA $1: esperado $2, obtido $3 — $(head -c 300 /tmp/resp.json 2>/dev/null)"; falhas=$((falhas+1)); fi
}
req() { curl -s -o /tmp/resp.json -w '%{http_code}' -b "$JAR" -c "$JAR" -H 'content-type: application/json' "$@"; }

json() { python3 -c 'import json,sys; print(json.dumps(dict(a.split("=",1) for a in sys.argv[1:])))' "$@"; }
CADASTRO=$(json perfil=ADVOGADO "nome=Ana Souza" "email=$EMAIL" senha=segredo123 "cpf=$CPF" "numeroOab=$OAB")
INVALIDO=$(json perfil=COMUM nome=x email=y senha=1 cpf=1)
LOGIN=$(json "email=$EMAIL" senha=segredo123)
LOGIN_ERRADO=$(json "email=$EMAIL" senha=errada123)

echo "REQ01 — cadastro"
verificar "cadastro advogado" 201 "$(req -X POST $GW/api/auth/cadastro -d "$CADASTRO")"
verificar "cadastro duplicado" 409 "$(req -X POST $GW/api/auth/cadastro -d "$CADASTRO")"
verificar "cadastro inválido" 400 "$(req -X POST $GW/api/auth/cadastro -d "$INVALIDO")"

echo "REQ03 — login"
verificar "login sem verificar e-mail" 403 "$(req -X POST $GW/api/auth/login -d "$LOGIN")"

TOKEN_VERIF=""
for _ in $(seq 1 20); do
  ID=$(curl -s "$MAILPIT/api/v1/search?query=to:$EMAIL" | python3 -c 'import sys,json; m=json.load(sys.stdin)["messages"]; print(m[0]["ID"] if m else "")')
  if [[ -n "$ID" ]]; then
    TOKEN_VERIF=$(curl -s "$MAILPIT/api/v1/message/$ID" | python3 -c 'import sys,json,re,urllib.parse; t=json.load(sys.stdin)["Text"]; print(urllib.parse.unquote(re.search(r"token=([^\s]+)",t).group(1)))')
    break
  fi
  sleep 0.5
done
verificar "e-mail de verificação recebido" sim "$([[ -n "$TOKEN_VERIF" ]] && echo sim || echo nao)"
VERIF=$(json "token=$TOKEN_VERIF")
verificar "verificar e-mail" 204 "$(req -X POST $GW/api/auth/verificar-email -d "$VERIF")"
verificar "link reutilizado" 400 "$(req -X POST $GW/api/auth/verificar-email -d "$VERIF")"
verificar "senha errada" 401 "$(req -X POST $GW/api/auth/login -d "$LOGIN_ERRADO")"
verificar "login" 200 "$(req -X POST $GW/api/auth/login -d "$LOGIN")"
TOKEN=$(python3 -c 'import json; print(json.load(open("/tmp/resp.json"))["tokenAcesso"])')
grep -q veridit_refresh "$JAR" && verificar "cookie refresh HttpOnly" sim sim || verificar "cookie refresh" sim nao

echo "Segurança do gateway"
verificar "rota protegida sem token" 401 "$(req $GW/api/usuarios/me)"
verificar "cabeçalho forjado sem token" 401 "$(req -H 'x-usuario-id: 00000000-0000-0000-0000-000000000000' $GW/api/usuarios/me)"
verificar "token adulterado" 401 "$(req -H "authorization: Bearer ${TOKEN}x" $GW/api/usuarios/me)"
verificar "rota protegida com token" 200 "$(req -H "authorization: Bearer $TOKEN" $GW/api/usuarios/me)"
grep -q '"cpf":"\*\*\*' /tmp/resp.json && verificar "CPF mascarado" sim sim || verificar "CPF mascarado" sim nao

echo "Créditos (ADR-0008)"
SALDO=""
for _ in $(seq 1 20); do
  req -H "authorization: Bearer $TOKEN" $GW/api/creditos/saldo >/dev/null
  SALDO=$(python3 -c 'import json; print(json.load(open("/tmp/resp.json")).get("disponivel"))')
  [[ "$SALDO" == "5" ]] && break; sleep 0.5
done
verificar "créditos de boas-vindas" 5 "$SALDO"
verificar "extrato" 200 "$(req -H "authorization: Bearer $TOKEN" $GW/api/creditos/extrato)"
verificar "saldo sem token" 401 "$(req $GW/api/creditos/saldo)"
verificar "rota interna não exposta" 404 "$(req -X POST -H "authorization: Bearer $TOKEN" $GW/api/interno/reservas)"
verificar "escape de prefixo bloqueado" 400 "$(req --path-as-is -X POST -H "authorization: Bearer $TOKEN" $GW/api/creditos/../interno/reservas)"
verificar "escape codificado bloqueado" 400 "$(req --path-as-is -X POST -H "authorization: Bearer $TOKEN" $GW/api/creditos/%2e%2e/interno/reservas)"

saldo() { python3 -c 'import json; d=json.load(open("/tmp/resp.json")); print("%s/%s" % (d["disponivel"], d["reservado"]))'; }

echo "REQ08 / REQ12 — registros"
NOVO=$(json "titulo=Publicação em rede social" url=exemplo.com/post/1 tipo=TELA)
verificar "iniciar registro" 202 "$(req -X POST -H "authorization: Bearer $TOKEN" $GW/api/registros -d "$NOVO")"
REG=$(python3 -c 'import json; print(json.load(open("/tmp/resp.json"))["id"])')
verificar "status aguardando sessão" AGUARDANDO_SESSAO "$(python3 -c 'import json; print(json.load(open("/tmp/resp.json"))["status"])')"
req -H "authorization: Bearer $TOKEN" $GW/api/creditos/saldo >/dev/null
verificar "1 crédito reservado" "4/1" "$(saldo)"
VIDEO=$(json "titulo=Vídeo" url=exemplo.com tipo=VIDEO)
verificar "vídeo ainda não disponível" 400 "$(req -X POST -H "authorization: Bearer $TOKEN" $GW/api/registros -d "$VIDEO")"
verificar "listar registros" 200 "$(req -H "authorization: Bearer $TOKEN" "$GW/api/registros?status=andamento")"
verificar "total em andamento" 1 "$(python3 -c 'import json; print(json.load(open("/tmp/resp.json"))["total"])')"
verificar "detalhar registro" 200 "$(req -H "authorization: Bearer $TOKEN" $GW/api/registros/$REG)"
verificar "cancelar registro" 200 "$(req -X POST -H "authorization: Bearer $TOKEN" $GW/api/registros/$REG/cancelar)"
req -H "authorization: Bearer $TOKEN" $GW/api/creditos/saldo >/dev/null
verificar "crédito estornado" "5/0" "$(saldo)"
verificar "registros sem token" 401 "$(req $GW/api/registros)"

echo "Renovação"
verificar "renovar sessão" 200 "$(req -X POST $GW/api/auth/renovar)"
TOKEN2=$(python3 -c 'import json; print(json.load(open("/tmp/resp.json"))["tokenAcesso"])')

echo "REQ04 — logout"
verificar "logout" 204 "$(req -X POST -H "authorization: Bearer $TOKEN2" $GW/api/auth/logout)"
sleep 0.3
verificar "token após logout" 401 "$(req -H "authorization: Bearer $TOKEN2" $GW/api/usuarios/me)"
verificar "renovar após logout" 401 "$(req -X POST $GW/api/auth/renovar)"

rm -f "$JAR"
echo; [[ $falhas -eq 0 ]] && echo "Todos os cenários passaram." || { echo "$falhas cenário(s) falharam."; exit 1; }
