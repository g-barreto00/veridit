/** Texto gravado junto da evidência: como qualquer pessoa verifica o pacote sem a plataforma. */
export function instrucoesVerificacao(hashManifesto: string): string {
  return `VERIFICAÇÃO DA EVIDÊNCIA — Veridit
===================================

Hash SHA-256 do manifesto: ${hashManifesto}

Arquivos:
  manifesto.json     lista de arquivos com seus hashes SHA-256 e os metadados técnicos da captura
  manifesto.sig      assinatura digital (ECDSA P-256 / SHA-256) do manifesto.json
  chave-publica.pem  chave pública da plataforma para conferir a assinatura
  manifesto.tsr      carimbo do tempo RFC 3161 sobre o hash do manifesto
  arquivos/          arquivos capturados

1) Integridade de cada arquivo (deve bater com o campo "sha256" do manifesto):
     sha256sum arquivos/*

2) Hash do manifesto (deve bater com o valor acima):
     sha256sum manifesto.json

3) Assinatura da plataforma sobre o manifesto:
     openssl dgst -sha256 -verify chave-publica.pem -signature manifesto.sig manifesto.json

4) Carimbo do tempo (data/hora em que o manifesto já existia):
     openssl ts -reply -in manifesto.tsr -text
     openssl ts -verify -data manifesto.json -in manifesto.tsr -CAfile cacert.pem -untrusted tsa.crt
   (cacert.pem e tsa.crt são publicados pela autoridade em https://freetsa.org)

Alterar qualquer byte de qualquer arquivo faz alguma destas verificações falhar.
`;
}
