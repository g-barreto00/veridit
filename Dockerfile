# Imagem genérica dos serviços Node do monorepo.
# Uso: docker build --build-arg SERVICO=identidade .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY compartilhado ./compartilhado
COPY servicos ./servicos
RUN npm ci --workspaces --include-workspace-root --ignore-scripts=false
ARG SERVICO
RUN npm run build -w @veridit/contratos -w @veridit/plataforma -w @veridit/mensageria \
 && npm run build -w @veridit/${SERVICO}

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
ARG SERVICO
WORKDIR /app/servicos/${SERVICO}
USER node
CMD ["node", "dist/main.js"]
