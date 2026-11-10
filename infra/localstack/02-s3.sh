#!/bin/bash
# ADR-0010: buckets separados. ADR-0004: bucket de evidências com Object Lock (WORM).
# Em desenvolvimento, o S3 é emulado pelo LocalStack (equivalente pela premissa P5).
set -euo pipefail

for b in captura-temporaria relatorios; do
  awslocal s3api head-bucket --bucket "$b" 2>/dev/null || awslocal s3api create-bucket --bucket "$b"
done

if ! awslocal s3api head-bucket --bucket evidencias 2>/dev/null; then
  awslocal s3api create-bucket --bucket evidencias --object-lock-enabled-for-bucket
fi
# Retenção padrão COMPLIANCE: nenhum usuário consegue apagar ou sobrescrever antes do prazo.
awslocal s3api put-object-lock-configuration --bucket evidencias \
  --object-lock-configuration "{\"ObjectLockEnabled\":\"Enabled\",\"Rule\":{\"DefaultRetention\":{\"Mode\":\"COMPLIANCE\",\"Days\":${RETENCAO_EVIDENCIAS_DIAS:-1}}}}"
echo "Buckets prontos"
