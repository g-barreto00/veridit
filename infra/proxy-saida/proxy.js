/**
 * Proxy de saída dos navegadores de captura (ADR-0003: "rede isolada, sem acesso à rede interna").
 *
 * A rede-captura é `internal` (sem rota para fora); este proxy é a única saída. Ele:
 *  - resolve o DNS e RECUSA destinos em faixas privadas, loopback, link-local etc. A checagem é
 *    feita no IP resolvido e a conexão vai para esse mesmo IP (evita DNS rebinding);
 *  - aceita só portas web;
 *  - anota as conexões de cada navegador (host → IP real) para o Coletor de Metadados do worker,
 *    já que, atrás de um proxy, o navegador só enxerga o IP do proxy.
 * Sem dependências externas.
 */
'use strict';
const http = require('node:http');
const net = require('node:net');
const dns = require('node:dns/promises');

const PORTA = Number(process.env.PORTA ?? 3128);
const TOKEN_CONSULTA = process.env.TOKEN_CONSULTA ?? '';
const PORTAS_PERMITIDAS = new Set([80, 443, 8080, 8443]);

const bloqueados = new net.BlockList();
for (const [rede, prefixo] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) bloqueados.addSubnet(rede, prefixo, 'ipv4');
for (const [rede, prefixo] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]]) {
  bloqueados.addSubnet(rede, prefixo, 'ipv6');
}

function ipProibido(ip) {
  const mapeado = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapeado) return ipProibido(mapeado[1]);
  return bloqueados.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

/** Resolve e escolhe um IP público; lança erro se o destino for proibido. */
async function destinoPermitido(host, porta) {
  if (!PORTAS_PERMITIDAS.has(porta)) throw new Error(`porta ${porta} não permitida`);
  const nome = host.replace(/^\[|\]$/g, '');
  const enderecos = net.isIP(nome) ? [{ address: nome }] : await dns.lookup(nome, { all: true });
  if (!enderecos.length) throw new Error('host não resolvido');
  // Se QUALQUER endereço do nome for interno, recusa (evita escolher o IP "bom" e depois mudar).
  if (enderecos.some((e) => ipProibido(e.address))) throw new Error(`destino interno recusado: ${host}`);
  return enderecos[0].address;
}

// ---- Registro de conexões por navegador (IP do cliente na rede-captura) ----
const conexoes = new Map();
function anotar(cliente, host, ip, porta) {
  const lista = conexoes.get(cliente) ?? [];
  lista.push({ host, ip, porta, em: new Date().toISOString() });
  if (lista.length > 1000) lista.shift();
  conexoes.set(cliente, lista);
}
const clienteDe = (socket) => (socket.remoteAddress ?? '').replace(/^::ffff:/, '');

const log = (msg, extra) => console.log(JSON.stringify({ nivel: 'info', msg, ...extra }));

const servidor = http.createServer(async (req, res) => {
  // Consulta do worker: GET /conexoes?cliente=<ip do navegador>
  if (req.url?.startsWith('/conexoes')) {
    if (!TOKEN_CONSULTA || req.headers['x-token-consulta'] !== TOKEN_CONSULTA) return res.writeHead(403).end();
    const cliente = new URL(req.url, 'http://proxy').searchParams.get('cliente') ?? '';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(conexoes.get(cliente) ?? []));
    if (new URL(req.url, 'http://proxy').searchParams.get('limpar') === '1') conexoes.delete(cliente);
    return;
  }

  // HTTP simples via proxy: a linha de requisição traz a URL absoluta.
  let alvo;
  try {
    alvo = new URL(req.url);
    if (alvo.protocol !== 'http:') throw new Error('protocolo não suportado');
  } catch {
    return res.writeHead(400).end('Requisição inválida para o proxy');
  }
  const porta = Number(alvo.port || 80);
  try {
    const ip = await destinoPermitido(alvo.hostname, porta);
    anotar(clienteDe(req.socket), alvo.hostname, ip, porta);
    const cabecalhos = { ...req.headers, host: alvo.host };
    delete cabecalhos['proxy-connection'];
    delete cabecalhos['proxy-authorization'];
    const saida = http.request(
      { host: ip, port: porta, method: req.method, path: alvo.pathname + alvo.search, headers: cabecalhos },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    saida.on('error', () => res.writeHead(502).end());
    req.pipe(saida);
  } catch (e) {
    log('recusado', { destino: alvo.host, motivo: e.message });
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Destino bloqueado pela plataforma');
  }
});

// HTTPS (e WebSocket seguro): túnel CONNECT host:porta.
servidor.on('connect', async (req, socketCliente, cabeca) => {
  const [host, portaTexto] = String(req.url).split(/:(?=\d+$)/);
  const porta = Number(portaTexto || 443);
  try {
    const ip = await destinoPermitido(host, porta);
    anotar(clienteDe(socketCliente), host.replace(/^\[|\]$/g, ''), ip, porta);
    const destino = net.connect(porta, ip, () => {
      socketCliente.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (cabeca?.length) destino.write(cabeca);
      destino.pipe(socketCliente);
      socketCliente.pipe(destino);
    });
    destino.on('error', () => socketCliente.destroy());
    socketCliente.on('error', () => destino.destroy());
  } catch (e) {
    log('recusado', { destino: req.url, motivo: e.message });
    socketCliente.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  }
});

servidor.listen(PORTA, () => log('proxy de saída no ar', { porta: PORTA }));
