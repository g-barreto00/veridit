# Navegador efêmero de captura (ADR-0003, opção b): um contêiner por sessão, criado e
# destruído pelo worker, ligado apenas à rede-captura (só saída para a internet).
# A versão do Playwright aqui DEVE ser igual à do playwright-core do worker.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
RUN npm install -g playwright@1.64.1 && npm cache clean --force
USER pwuser
WORKDIR /home/pwuser
EXPOSE 3000
CMD ["playwright", "run-server", "--port", "3000", "--host", "0.0.0.0"]
