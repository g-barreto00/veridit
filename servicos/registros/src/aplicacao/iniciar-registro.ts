import { randomUUID } from 'node:crypto';
import type { TipoRegistro } from '@veridit/contratos';
import { criarEvento } from '@veridit/mensageria';
import { ErroIndisponivel, ErroLimiteSessoes, ErroSemSaldo, ErroValidacao } from '../dominio/erros';
import {
  SaldoInsuficiente,
  type CarteiraCreditos,
  type ExecutorTransacao,
  type RegistradorEventos,
  type RepositorioRegistros,
  type Relogio,
} from '../dominio/portas';
import { ESTADOS_SESSAO_ATIVA, Registro } from '../dominio/registro';

export const MAX_SESSOES_SIMULTANEAS = 2; // ADR-0009
export const DURACAO_MAXIMA_SESSAO_S = 30 * 60; // ADR-0003

/** Tipos habilitados nesta versão. O vídeo de navegação (REQ09) entra na sprint 2. */
const TIPOS_HABILITADOS: TipoRegistro[] = ['TELA'];

export interface DadosNovoRegistro {
  usuarioId: string;
  titulo: string;
  url: string;
  tipo: string;
}

export function normalizarUrl(bruta: string): string | undefined {
  const texto = (bruta ?? '').trim();
  if (!texto || texto.length > 2048) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(texto) ? texto : `https://${texto}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * REQ08 — Iniciar registro de conteúdo. Primeiro passo da saga (fluxo s01-registro):
 * cria o registro, reserva créditos (síncrono, ADR-0008) e publica CapturaSolicitada (outbox).
 */
export class IniciarRegistro {
  constructor(
    private readonly registros: RepositorioRegistros,
    private readonly carteira: CarteiraCreditos,
    private readonly eventos: RegistradorEventos,
    private readonly transacao: ExecutorTransacao,
    private readonly relogio: Relogio,
  ) {}

  async executar(dados: DadosNovoRegistro) {
    const titulo = (dados.titulo ?? '').trim().replace(/\s+/g, ' ');
    const url = normalizarUrl(dados.url);
    const erros: Record<string, string> = {};
    if (titulo.length < 3 || titulo.length > 150) erros.titulo = 'O título deve ter entre 3 e 150 caracteres';
    if (!url) erros.url = 'Informe um endereço de site válido (http ou https)';
    if (!['TELA', 'VIDEO'].includes(dados.tipo)) erros.tipo = 'Escolha captura de tela ou vídeo de navegação';
    else if (!TIPOS_HABILITADOS.includes(dados.tipo as TipoRegistro)) {
      erros.tipo = 'O vídeo de navegação estará disponível na próxima versão';
    }
    if (Object.keys(erros).length) throw new ErroValidacao('Dados inválidos', { campos: erros });
    const tipo = dados.tipo as TipoRegistro;

    // 1) Cria o registro (Iniciado), respeitando o limite de sessões simultâneas.
    const registro = await this.transacao.executar(async (tx) => {
      await this.registros.bloquearUsuario(tx, dados.usuarioId);
      const ativos = await this.registros.contarEmEstados(tx, dados.usuarioId, ESTADOS_SESSAO_ATIVA);
      if (ativos >= MAX_SESSOES_SIMULTANEAS) {
        throw new ErroLimiteSessoes(`Você já tem ${MAX_SESSOES_SIMULTANEAS} registros em andamento. Conclua um deles antes de iniciar outro.`);
      }
      const novo = Registro.novo({
        id: randomUUID(),
        usuarioId: dados.usuarioId,
        titulo,
        url: url!,
        tipo,
        inicioEm: this.relogio.agora(),
      });
      await this.registros.inserir(tx, novo);
      return novo;
    });

    // 2) Reserva os créditos (chamada síncrona à Carteira).
    try {
      await this.carteira.reservar(dados.usuarioId, registro.id, tipo);
    } catch (e) {
      if (e instanceof SaldoInsuficiente) {
        await this.finalizar(registro.id, 'RECUSADO', 'Saldo insuficiente');
        throw new ErroSemSaldo('Você não tem créditos suficientes para este registro.', {
          necessario: e.necessario,
          disponivel: e.disponivel,
        });
      }
      // Carteira indisponível: a reserva pode ter acontecido ou não. Compensa (idempotente);
      // se nem isso for possível, o Monitor de Prazos estorna depois.
      await this.carteira.estornar(registro.id, 'Falha ao iniciar registro').catch(() => undefined);
      await this.finalizar(registro.id, 'FALHOU', 'Carteira de créditos indisponível').catch(() => undefined);
      throw new ErroIndisponivel('Não foi possível iniciar o registro agora. Tente novamente em instantes.');
    }

    // 3) Créditos reservados → solicita a sessão de captura (mesmo commit do evento, ADR-0007).
    return this.transacao.executar(async (tx) => {
      const r = (await this.registros.carregarParaAlterar(tx, registro.id))!;
      const agora = this.relogio.agora();
      r.transicionar('CREDITOS_RESERVADOS', agora, 'Créditos reservados');
      r.transicionar('AGUARDANDO_SESSAO', agora, 'Captura solicitada');
      await this.registros.salvar(tx, r);
      await this.eventos.registrar(
        tx,
        criarEvento(
          'CapturaSolicitada',
          {
            registroId: r.id,
            usuarioId: r.usuarioId,
            tipo,
            urlInicial: r.estado.url,
            duracaoMaximaSegundos: DURACAO_MAXIMA_SESSAO_S,
          },
          { correlationId: r.id, origem: 'registros' },
        ),
      );
      return { id: r.id, status: r.status, titulo: r.estado.titulo, url: r.estado.url, tipo };
    });
  }

  private finalizar(id: string, status: 'RECUSADO' | 'FALHOU', motivo: string) {
    return this.transacao.executar(async (tx) => {
      const r = (await this.registros.carregarParaAlterar(tx, id))!;
      if (r.podeIrPara(status)) {
        r.transicionar(status, this.relogio.agora(), motivo);
        await this.registros.salvar(tx, r);
      }
    });
  }
}
