# Imagem do worker de captura. Conformidade da ADR-0002: NÃO contém driver nem credenciais de
# banco. Por isso não usa a imagem genérica do monorepo: instala só as dependências de produção
# do worker e dos pacotes compartilhados que ele usa (contratos e mensageria, com pg opcional).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY compartilhado ./compartilhado
COPY servicos ./servicos
RUN npm ci
RUN npm run build -w @veridit/contratos -w @veridit/mensageria -w @veridit/captura
# Monta um pacote enxuto em /saida com cópias (não links) dos pacotes compartilhados.
RUN node -e ' \
  const fs = require("fs"); const p = require("./servicos/captura/package.json"); \
  const deps = { ...p.dependencies }; \
  for (const n of ["contratos", "mensageria"]) { \
    fs.cpSync(`compartilhado/${n}/dist`, `/saida/pacotes/${n}/dist`, { recursive: true }); \
    fs.copyFileSync(`compartilhado/${n}/package.json`, `/saida/pacotes/${n}/package.json`); \
    deps[`@veridit/${n}`] = `file:./pacotes/${n}`; \
  } \
  const m = JSON.parse(fs.readFileSync("/saida/pacotes/mensageria/package.json")); \
  m.dependencies["@veridit/contratos"] = "file:../contratos"; delete m.devDependencies; \
  fs.writeFileSync("/saida/pacotes/mensageria/package.json", JSON.stringify(m)); \
  fs.cpSync("servicos/captura/dist", "/saida/dist", { recursive: true }); \
  fs.writeFileSync("/saida/package.json", JSON.stringify({ name: "veridit-captura", private: true, dependencies: deps })); \
'
WORKDIR /saida
RUN npm install --omit=dev --omit=peer --install-links --no-package-lock --no-audit --no-fund

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /saida /app
# Roda como root apenas para acessar o socket do Docker e criar os navegadores efêmeros.
CMD ["node", "dist/main.js"]
