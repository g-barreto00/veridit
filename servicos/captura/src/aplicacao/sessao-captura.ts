import { createHash } from 'node:crypto';
import type { BrowserContext, CDPSession, Page } from 'playwright-core';
import type { WebSocket } from 'ws';
import type { ArtefatoCapturado, MetadadosTecnicos } from '@veridit/contratos';
import type { Registrador } from '@veridit/mensageria';
import type { ArmazenamentoTemporario, NavegadorEfemero } from '../portas';
import type { ColetorMetadados } from './coletor-metadados';
import { COMANDOS, type Comando, type ContextoComando } from './comandos';

export const VIEWPORT = { width: 1280, height: 720 };

export interface DadosSessao {
  /** Proxy de saída: única rota do navegador para fora (ADR-0003). */
  proxySaida: string;
  registroId: string;
  usuarioId: string;
  sessaoId: string;
  token: string;
  urlInicial: string;
  duracaoMaximaMs: number;
  /** Sem ninguém conectado por este tempo, a sessão é encerrada como abandonada. */
  ociosidadeMaximaMs: number;
}

export type ResultadoSessao =
  | { tipo: 'concluida'; inicio: Date; fim: Date; artefatos: ArtefatoCapturado[]; metadados: MetadadosTecnicos[] }
  | { tipo: 'falhou'; motivo: string };

/**
 * Gerenciador de Sessão + Ponte de Streaming + Capturador de Tela (C12).
 * O usuário vê e controla o navegador remoto, mas o conteúdo é renderizado e capturado no
 * ambiente da plataforma (ADR-0003).
 */
export class SessaoCaptura {
  private contexto?: BrowserContext;
  private pagina?: Page;
  private cliente?: WebSocket;
  private cdp?: CDPSession;
  private readonly artefatos: ArtefatoCapturado[] = [];
  private readonly metadados: MetadadosTecnicos[] = [];
  private readonly timers: NodeJS.Timeout[] = [];
  private temporizadorOcioso?: NodeJS.Timeout;
  private capturando = false;
  private encerrada = false;
  private inicio = new Date();
  private resolver!: (r: ResultadoSessao) => void;

  /** Resolve quando a sessão termina (concluída, cancelada, abandonada ou por tempo). */
  readonly resultado = new Promise<ResultadoSessao>((r) => (this.resolver = r));

  constructor(
    readonly dados: DadosSessao,
    private readonly navegador: NavegadorEfemero,
    private readonly armazenamento: ArmazenamentoTemporario,
    private readonly coletor: ColetorMetadados,
    private readonly log: Registrador,
  ) {}

  async iniciar(): Promise<void> {
    this.contexto = await this.navegador.navegador.newContext({
      viewport: VIEWPORT,
      proxy: { server: this.dados.proxySaida },
      acceptDownloads: false,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    });
    const pagina = (this.pagina = await this.contexto.newPage());
    this.coletor.observar(pagina);
    pagina.on('dialog', (d) => void d.dismiss().catch(() => undefined));
    // Pop-ups e novas abas: abre o endereço na própria página, mantendo uma única tela.
    this.contexto.on('page', (nova) => {
      if (nova === pagina) return;
      void nova.waitForLoadState('domcontentloaded').catch(() => undefined).then(async () => {
        const url = nova.url();
        await nova.close().catch(() => undefined);
        if (url && url !== 'about:blank') await pagina.goto(url, { waitUntil: 'commit' }).catch(() => undefined);
      });
    });
    pagina.on('framenavigated', (f) => {
      if (f === pagina.mainFrame()) this.enviar({ tipo: 'navegacao', url: f.url() });
    });

    this.inicio = new Date();
    await pagina.goto(this.dados.urlInicial, { waitUntil: 'commit', timeout: 30_000 }).catch((e) => {
      this.log.warn('falha ao abrir URL inicial', { registroId: this.dados.registroId, erro: String(e) });
    });

    this.timers.push(setTimeout(() => void this.falhar('Duração máxima da sessão atingida'), this.dados.duracaoMaximaMs));
    this.timers.push(
      setInterval(() => {
        this.enviar({ tipo: 'tempo', restanteSegundos: this.restanteSegundos() });
      }, 1000),
    );
    this.armarOciosidade();
  }

  /** Conecta (ou reconecta) a aplicação web. Só um cliente por vez. */
  async conectar(ws: WebSocket): Promise<void> {
    if (this.encerrada) {
      ws.close(4410, 'Sessão encerrada');
      return;
    }
    if (this.cliente && this.cliente !== ws) this.cliente.close(4409, 'Sessão aberta em outra janela');
    this.cliente = ws;
    if (this.temporizadorOcioso) clearTimeout(this.temporizadorOcioso);

    ws.on('message', (bruto) => void this.aoMensagem(String(bruto)));
    ws.on('close', () => {
      if (this.cliente !== ws) return;
      this.cliente = undefined;
      void this.cdp?.send('Page.stopScreencast').catch(() => undefined);
      this.armarOciosidade();
    });

    this.enviar({
      tipo: 'pronta',
      url: this.pagina?.url(),
      largura: VIEWPORT.width,
      altura: VIEWPORT.height,
      capturas: this.artefatos.filter((a) => a.tipo === 'IMAGEM').length,
    });
    this.enviar({ tipo: 'tempo', restanteSegundos: this.restanteSegundos() });
    await this.iniciarScreencast();
  }

  private async iniciarScreencast() {
    if (!this.pagina || !this.contexto) return;
    if (!this.cdp) {
      this.cdp = await this.contexto.newCDPSession(this.pagina);
      this.cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
        // Contrapressão: se o cliente está atrasado, descarta o quadro (o próximo virá atualizado).
        if (this.cliente && this.cliente.bufferedAmount < 1_000_000) this.enviar({ tipo: 'quadro', imagem: data });
        void this.cdp?.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
      });
    }
    this.log.info('iniciando screencast', { sessaoId: this.dados.sessaoId, inicios: ++this.iniciosScreencast });
    // Idempotente: numa reconexão o screencast anterior pode ainda estar ativo.
    await this.cdp.send('Page.stopScreencast').catch(() => undefined);
    try {
      await this.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 70,
        maxWidth: VIEWPORT.width,
        maxHeight: VIEWPORT.height,
      });
    } catch (e) {
      if (!String(e).includes('already active')) throw e;
    }
  }
  private iniciosScreencast = 0;

  private async aoMensagem(bruto: string) {
    let cmd: Comando;
    try {
      cmd = JSON.parse(bruto);
    } catch {
      return;
    }
    const executor = COMANDOS[cmd?.tipo as Comando['tipo']] as ((c: ContextoComando, m: Comando) => Promise<unknown>) | undefined;
    if (!executor || !this.pagina || this.encerrada) return;
    try {
      await executor(this.contextoComando(), cmd);
    } catch (e) {
      this.enviar({ tipo: 'erro', mensagem: e instanceof Error ? e.message : 'Falha ao executar comando' });
    }
  }

  private contextoComando(): ContextoComando {
    return {
      pagina: this.pagina!,
      capturarTela: () => this.capturarTela(),
      concluir: () => this.concluir(),
      cancelar: () => this.falhar('Cancelado pelo usuário'),
    };
  }

  /** REQ11 — Captura de tela da página no estado atual, com metadados técnicos. */
  private async capturarTela() {
    if (this.capturando) return;
    this.capturando = true;
    try {
      const pagina = this.pagina!;
      const numero = this.artefatos.filter((a) => a.tipo === 'IMAGEM').length + 1;
      // Captura a tela que o usuário está vendo (tela 10: "você pode capturar várias telas").
      const [imagem, meta] = await Promise.all([
        pagina.screenshot({ timeout: 15_000, animations: 'disabled' }),
        this.coletor.coletar(pagina),
      ]);
      const nomeArquivo = `captura-${String(numero).padStart(3, '0')}.png`;
      const chave = `${this.dados.registroId}/${nomeArquivo}`;
      await this.armazenamento.enviar(chave, imagem, 'image/png');

      this.artefatos.push({
        chave,
        nomeArquivo,
        tipo: 'IMAGEM',
        tamanhoBytes: imagem.length,
        sha256: sha256(imagem),
        capturadoEm: meta.horarioNtp ?? meta.horarioSistema,
        url: meta.urlFinal,
      });
      this.metadados.push(meta);
      this.enviar({
        tipo: 'captura',
        numero,
        nomeArquivo,
        url: meta.urlFinal,
        tamanhoBytes: imagem.length,
        // Resumo para o painel "Metadados coletados" (tela 11)
        metadados: {
          ip: meta.ipDestino,
          dns: meta.dns,
          tls: meta.certificadoTls,
          horario: meta.horarioNtp ?? meta.horarioSistema,
          fonteHorario: meta.fonteHorario,
        },
      });
    } finally {
      this.capturando = false;
    }
  }

  /** REQ11 — Concluir captura de tela: grava os metadados e entrega o resultado. */
  private async concluir() {
    if (this.encerrada) return;
    if (!this.artefatos.some((a) => a.tipo === 'IMAGEM')) {
      throw new Error('Faça ao menos uma captura de tela antes de concluir');
    }
    const fim = new Date();
    const conteudo = Buffer.from(
      JSON.stringify(
        {
          registroId: this.dados.registroId,
          sessaoId: this.dados.sessaoId,
          urlInicial: this.dados.urlInicial,
          inicio: this.inicio.toISOString(),
          fim: fim.toISOString(),
          capturas: this.artefatos.map((a, i) => ({ ...a, metadados: this.metadados[i] })),
        },
        null,
        2,
      ),
    );
    const chave = `${this.dados.registroId}/metadados.json`;
    await this.armazenamento.enviar(chave, conteudo, 'application/json');
    const artefatos: ArtefatoCapturado[] = [
      ...this.artefatos,
      {
        chave,
        nomeArquivo: 'metadados.json',
        tipo: 'METADADOS',
        tamanhoBytes: conteudo.length,
        sha256: sha256(conteudo),
        capturadoEm: fim.toISOString(),
        url: this.dados.urlInicial,
      },
    ];
    await this.encerrar({ tipo: 'concluida', inicio: this.inicio, fim, artefatos, metadados: this.metadados }, 'Concluída');
  }

  falhar(motivo: string) {
    return this.encerrar({ tipo: 'falhou', motivo }, motivo);
  }

  private async encerrar(resultado: ResultadoSessao, mensagem: string) {
    if (this.encerrada) return;
    this.encerrada = true;
    this.timers.forEach(clearTimeout);
    if (this.temporizadorOcioso) clearTimeout(this.temporizadorOcioso);
    this.enviar({ tipo: 'encerrada', resultado: resultado.tipo, mensagem });
    this.cliente?.close(1000, 'Sessão encerrada');
    await this.contexto?.close().catch(() => undefined);
    this.resolver(resultado);
  }

  private restanteSegundos() {
    return Math.round(Math.max(0, this.dados.duracaoMaximaMs - (Date.now() - this.inicio.getTime())) / 1000);
  }

  private armarOciosidade() {
    if (this.encerrada) return;
    if (this.temporizadorOcioso) clearTimeout(this.temporizadorOcioso);
    this.temporizadorOcioso = setTimeout(
      () => void this.falhar('Sessão abandonada (ninguém conectado)'),
      this.dados.ociosidadeMaximaMs,
    );
  }

  private enviar(msg: Record<string, unknown>) {
    if (this.cliente?.readyState === 1) this.cliente.send(JSON.stringify(msg));
  }
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
