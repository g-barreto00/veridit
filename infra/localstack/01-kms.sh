#!/bin/bash
# ADR-0004: chave de assinatura das evidências em serviço de KMS, nunca exportada.
# Em desenvolvimento, o LocalStack emula a AWS KMS (equivalente pela premissa P5).
set -euo pipefail

if awslocal kms describe-key --key-id alias/veridit-selagem >/dev/null 2>&1; then
  echo "Chave alias/veridit-selagem já existe"
  exit 0
fi

KEY_ID=$(awslocal kms create-key \
  --key-spec ECC_NIST_P256 \
  --key-usage SIGN_VERIFY \
  --description "Veridit - assinatura de manifestos de evidencia" \
  --query KeyMetadata.KeyId --output text)

awslocal kms create-alias --alias-name alias/veridit-selagem --target-key-id "$KEY_ID"
echo "Chave de selagem criada: $KEY_ID"
