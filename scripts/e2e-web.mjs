/**
 * Teste da interface em navegador real (Playwright), percorrendo o fluxo como um usuário:
 * criar conta → confirmar e-mail → entrar → novo registro → sessão interativa → capturar →
 * concluir → selagem → meus registros → sair. Salva uma captura de cada tela.
 *
 * Roda dentro da imagem do navegador, na rede interna:  ./scripts/e2e-web.sh
 */
import { randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// O Playwright está instalado globalmente na imagem do navegador (NODE_PATH).
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = 'http://localhost'; // "localhost" é mapeado para o contêiner web (cookie Secure)
const MAILPIT = process.env.MAILPIT ?? 'http://mailpit:8025';
const SAIDA = process.env.SAIDA ?? '/saida';
const URL_ALVO = process.env.URL_ALVO ?? 'https://example.com/';
mkdirSync(SAIDA, { recursive: true });

let falhas = 0;
const ok = (nome, cond, detalhe = '') => {
  console.log(`  ${cond ? 'ok   ' : 'FALHA'} ${nome}${detalhe ? ` (${detalhe})` : ''}`);
  if (!cond) falhas++;
};
const cpf = () => {
  const d = Array.from({ length: 9 }, () => randomInt(10));
  for (const p of [10, 11]) {
    const r = (d.reduce((a, v, i) => a + v * (p - i), 0) * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
};

const navegador = await chromium.launch({ args: ['--host-resolver-rules=MAP localhost web'] });
const pagina = await navegador.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' });
const foto = (nome) => pagina.screenshot({ path: `${SAIDA}/${nome}.png` });
const email = `ana.${Date.now()}@exemplo.com`;

try {
  console.log('Telas 01/02 — acesso');
  await pagina.goto(`${BASE}/registros`);
  await pagina.waitForURL('**/entrar');
  ok('rota protegida redireciona para Entrar', true);
  await foto('01-entrar');

  await pagina.getByRole('link', { name: 'Criar conta' }).click();
  await pagina.getByLabel('Nome completo').fill('Ana Souza Lima');
  await pagina.getByLabel('E-mail').fill(email);
  await pagina.getByLabel('CPF').fill(cpf());
  await pagina.getByLabel('Número da OAB').fill(`BA ${randomInt(1000, 999999)}`);
  await pagina.getByLabel('Senha *', { exact: true }).fill('curta1');
  await pagina.getByLabel('Confirmar senha').fill('curta1');
  await pagina.getByRole('checkbox').check();
  await foto('02-criar-conta');
  await pagina.getByRole('button', { name: 'Criar conta' }).click();
  ok('senha curta recusada pela política', await pagina.getByText('pelo menos 10 caracteres').waitFor({ timeout: 5000 }).then(() => true, () => false));

  await pagina.getByLabel('Senha *', { exact: true }).fill('segredo1234');
  await pagina.getByLabel('Confirmar senha').fill('segredo1234');
  await pagina.getByRole('button', { name: 'Criar conta' }).click();
  await pagina.getByText('Confirme seu e-mail').waitFor();
  ok('conta criada; pede confirmação por e-mail', true);

  let link;
  for (let i = 0; i < 30 && !link; i++) {
    const busca = await (await fetch(`${MAILPIT}/api/v1/search?query=to:${email}`)).json();
    if (busca.messages?.length) {
      const m = await (await fetch(`${MAILPIT}/api/v1/message/${busca.messages[0].ID}`)).json();
      link = m.Text.match(/(http\S+verificar-email\S+)/)?.[1];
    } else await new Promise((r) => setTimeout(r, 300));
  }
  ok('e-mail de confirmação recebido', !!link);
  await pagina.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  await pagina.getByText('E-mail confirmado').waitFor();
  ok('e-mail confirmado pelo link', true);

  await pagina.getByRole('link', { name: 'Entrar' }).click();
  await pagina.getByLabel('E-mail').fill(email);
  await pagina.getByLabel('Senha').fill('segredo1234');
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  await pagina.waitForURL('**/registros');
  await pagina.getByText('5 créditos').waitFor();
  ok('login (REQ03) e créditos de boas-vindas no cabeçalho', true);
  ok('perfil com OAB no cabeçalho', await pagina.getByText('OAB/BA').isVisible());
  await foto('05-meus-registros-vazio');

  await pagina.reload();
  await pagina.getByText('Meus registros', { exact: true }).first().waitFor();
  ok('sessão sobrevive ao recarregar (refresh token em cookie HttpOnly)', !pagina.url().includes('/entrar'));

  console.log('Tela 10 — novo registro (REQ08)');
  await pagina.getByRole('link', { name: 'Novo registro' }).first().click();
  await pagina.getByLabel('Endereço do site').fill(URL_ALVO.replace('https://', ''));
  await pagina.getByLabel('Título do registro').fill('Publicação de teste pela interface');
  await foto('10-novo-registro');
  await pagina.getByRole('button', { name: 'Iniciar registro' }).click();
  await pagina.waitForURL('**/sessao');

  console.log('Tela 11 — sessão de captura (REQ11)');
  const capturar = pagina.getByRole('button', { name: 'Capturar tela' });
  await capturar.waitFor();
  await pagina.waitForFunction(() => {
    const c = document.querySelector('canvas');
    if (!c) return false;
    const px = c.getContext('2d').getImageData(640, 360, 1, 1).data;
    return px[3] > 0;
  }, null, { timeout: 60_000 });
  ok('tela remota desenhada no canvas (screencast)', true);
  ok('endereço exibido na barra', (await pagina.getByLabel('Endereço').inputValue()).includes(new URL(URL_ALVO).hostname));
  await pagina.locator('canvas').click({ position: { x: 300, y: 300 } });
  await pagina.mouse.wheel(0, 300);
  await capturar.click();
  await pagina.getByText('captura-001.png').waitFor({ timeout: 30_000 });
  await capturar.click();
  await pagina.getByText('captura-002.png').waitFor({ timeout: 30_000 });
  ok('duas capturas listadas no painel', true);
  const ip = await pagina.locator('dt:has-text("IP do servidor") + dd').innerText();
  ok('metadados coletados exibidos', /\d+\.\d+\.\d+\.\d+|:/.test(ip), ip);
  await foto('11-sessao-captura');

  await pagina.getByRole('button', { name: 'Concluir registro' }).click();
  console.log('Tela 12 — selagem (ADR-0004)');
  await pagina.waitForURL(/\/registros\/[0-9a-f-]{36}$/);
  await foto('12-selando');
  await pagina.getByText('Evidência selada').waitFor({ timeout: 60_000 });
  await pagina.getByText('Hashes, assinatura e carimbo conferidos').waitFor({ timeout: 15_000 });
  ok('evidência selada e verificada', true);
  ok('carimbo do FreeTSA exibido', await pagina.getByText('freetsa.org').isVisible());
  await pagina.getByText('4 créditos').waitFor({ timeout: 20_000 });
  ok('crédito consumido (cabeçalho mostra 4)', true);
  await foto('12-selada');

  console.log('Tela 05 — listagem (REQ12) e saída (REQ04)');
  await pagina.getByRole('link', { name: 'Ver meus registros' }).click();
  await pagina.getByText('Publicação de teste pela interface').waitFor();
  ok('registro concluído na listagem', await pagina.locator('tr', { hasText: 'Publicação de teste' }).getByText('Concluído').isVisible());
  await foto('05-meus-registros');

  await pagina.getByRole('button', { name: 'Sair' }).click();
  await pagina.waitForURL('**/entrar');
  await pagina.goto(`${BASE}/registros`);
  await pagina.waitForURL('**/entrar');
  ok('logout (REQ04): sessão não volta ao recarregar', true);
} catch (e) {
  falhas++;
  console.log(`  FALHA inesperada: ${e.message.split('\n')[0]}`);
  await foto('erro').catch(() => undefined);
} finally {
  await navegador.close();
}
console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTodos os cenários da interface passaram.');
process.exit(falhas ? 1 : 0);
