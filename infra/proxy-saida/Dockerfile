# Proxy de saída da rede-captura (ADR-0003): única rota dos navegadores para fora.
FROM node:22-slim
WORKDIR /app
COPY proxy.js .
USER node
EXPOSE 3128
CMD ["node", "proxy.js"]
