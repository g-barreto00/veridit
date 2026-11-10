#!/usr/bin/env node
/**
 * Teste ponta a ponta da sessão interativa de captura (REQ08, REQ11; ADR-0003) pelo gateway.
 * Pré-requisito: docker compose up -d   |   Uso: node scripts/e2e-sessao.mjs [url]
 */
import { randomInt } from 'node:crypto';
import WebSocket from 'ws';

const GW = process.env.GW ?? 'http://localhost:8080';
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:8025';
const URL_ALVO = process.argv[2] ?? 'https://example.com/';
let falhas = 0;

const verificar = (nome, ok, detalhe = '') => {
  console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${nome}${detalhe ? ` (${detalhe})` : ''}`);
  if (!ok) falhas++;
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function gerarCpf() {
  const d = Array.from({ length: 9 }, () => randomInt(10));
  for (const p of [10, 11]) {
    const s = d.reduce((acc, v, i) => acc + v * (p - i), 0);
    const r = (s * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
}

async function api(metodo, caminho, { token, corpo } = {}) {
  const r = await fetch(GW + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: corpo && JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
}

async function criarUsuarioLogado() {
  const email = `sessao.${Date.now()}.${randomInt(1e6)}@exemplo.com`;
  await api('POST', '/api/auth/cadastro', {
    corpo: { perfil: 'COMUM', nome: 'Teste Sessão', email, senha: 'segredo123', cpf: gerarCpf() },
  });
  for (let i = 0; i < 30; i++) {
    const busca = await (await fetch(`${MAILPIT}/api/v1/search?query=to:${email}`)).json();
    if (busca.messages?.length) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${busca.messages[0].ID}`)).json();
      const token = decodeURIComponent(msg.Text.match(/token=(\S+)/)[1]);
      await api('POST', '/api/auth/verificar-email', { corpo: { token } });
      break;
    }
    await esperar(300);
  }
  const login = await api('POST', '/api/auth/login', { corpo: { email, senha: 'segredo123' } });
  return login.corpo.tokenAcesso;
}

async function statusRegistro(token, id) {
  return (await api('GET', `/api/registros/${id}`, { token })).corpo.status;
}

async function aguardarStatus(token, id, alvo, ms = 90_000) {
  const fim = Date.now() + ms;
  let s;
  while (Date.now() < fim) {
    s = await statusRegistro(token, id);
    if (s === alvo) return s;
    await esperar(500);
  }
  return s;
}

function abrirWs(registroId, token) {
  return new WebSocket(`${GW.replace('http', 'ws')}/api/sessoes/${registroId}/ws?token=${encodeURIComponent(token)}`);
}

/** Tenta conectar e devolve o status HTTP da recusa (ou 101 se conectou). */
function statusConexao(registroId, token) {
  return new Promise((resolve) => {
    const ws = abrirWs(registroId, token);
    ws.on('open', () => {
      ws.close();
      resolve(101);
    });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve(0));
  });
}

console.log(`Sessão interativa de captura — ${URL_ALVO}`);
const token = await criarUsuarioLogado();
verificar('usuário logado', !!token);

const novo = await api('POST', '/api/registros', { token, corpo: { titulo: 'Teste de sessão', url: URL_ALVO, tipo: 'TELA' } });
verificar('registro iniciado', novo.status === 202, String(novo.status));
const id = novo.corpo.id;

const inicioEspera = Date.now();
const s1 = await aguardarStatus(token, id, 'EM_CAPTURA');
verificar('worker abriu o navegador isolado (EM_CAPTURA)', s1 === 'EM_CAPTURA', `${s1}, ${((Date.now() - inicioEspera) / 1000).toFixed(1)}s`);

console.log('Segurança da sessão');
const outro = await criarUsuarioLogado();
verificar('outro usuário não acessa a sessão', (await statusConexao(id, outro)) === 404);
verificar('sem token', (await statusConexao(id, '')) === 401);
verificar('token adulterado', (await statusConexao(id, token + 'x')) === 401);

console.log('Streaming e comandos');
const ws = abrirWs(id, token);
const recebidas = [];
let quadros = 0;
ws.on('message', (bruto) => {
  const m = JSON.parse(String(bruto));
  if (m.tipo === 'quadro') quadros++;
  else recebidas.push(m);
});
const aguardarMsg = async (tipo, ms = 30_000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const i = recebidas.findIndex((m) => m.tipo === tipo);
    if (i >= 0) return recebidas.splice(i, 1)[0];
    await esperar(100);
  }
  return undefined;
};
const enviar = (m) => ws.send(JSON.stringify(m));

await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
const pronta = await aguardarMsg('pronta');
verificar('sessão pronta', !!pronta, pronta && `${pronta.largura}x${pronta.altura}`);
await esperar(2500);
verificar('quadros da tela recebidos (screencast)', quadros > 0, `${quadros} quadros`);

enviar({ tipo: 'mouse', acao: 'move', x: 300, y: 300 });
enviar({ tipo: 'rolar', x: 300, y: 300, deltaX: 0, deltaY: 400 });
enviar({ tipo: 'tecla', acao: 'down', tecla: 'End' });
enviar({ tipo: 'tecla', acao: 'up', tecla: 'End' });
await esperar(500);

enviar({ tipo: 'concluir' });
const erroSemCaptura = await aguardarMsg('erro', 5000);
verificar('não conclui sem captura', !!erroSemCaptura, erroSemCaptura?.mensagem);

console.log('REQ11 — captura de tela');
enviar({ tipo: 'capturar' });
const c1 = await aguardarMsg('captura');
verificar('captura 1', c1?.numero === 1, c1 && `${c1.url}, ${c1.tamanhoBytes} bytes`);
enviar({ tipo: 'capturar' });
const c2 = await aguardarMsg('captura');
verificar('captura 2', c2?.numero === 2);

enviar({ tipo: 'concluir' });
const fim = await aguardarMsg('encerrada');
verificar('sessão concluída', fim?.resultado === 'concluida', fim?.mensagem);

const s2 = await aguardarStatus(token, id, 'SELANDO', 15_000);
verificar('registro foi para Selando', s2 === 'SELANDO', s2);
verificar('rota da sessão removida', (await statusConexao(id, token)) === 404);

console.log(falhas ? `\n${falhas} cenário(s) falharam.` : '\nTodos os cenários passaram.');
console.log(`registroId=${id}`);
process.exit(falhas ? 1 : 0);
