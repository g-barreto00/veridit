/**
 * Cliente da API do Veridit (via API Gateway).
 * ADR-0005: o token de acesso (15 min) fica só em memória — nunca em localStorage — e o
 * refresh token fica num cookie HttpOnly que o JavaScript não lê. Ao receber 401, o cliente
 * renova a sessão uma vez e repete a requisição.
 */

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: 'ADVOGADO' | 'COMUM';
  numeroOab?: string;
}

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly campos: Record<string, string> = {},
  ) {
    super(mensagem);
  }
}

type OuvinteSessao = (usuario: Usuario | null) => void;

class ClienteApi {
  private tokenAcesso: string | null = null;
  private renovando: Promise<Usuario | null> | null = null;
  private ouvintes = new Set<OuvinteSessao>();

  /** Avisado quando a sessão começa ou termina (ex.: refresh token revogado). */
  aoMudarSessao(f: OuvinteSessao) {
    this.ouvintes.add(f);
    return () => this.ouvintes.delete(f);
  }

  get token() {
    return this.tokenAcesso;
  }

  async entrar(email: string, senha: string): Promise<Usuario> {
    const r = await this.bruto('POST', '/api/auth/login', { email, senha });
    this.tokenAcesso = r.tokenAcesso;
    this.notificar(r.usuario);
    return r.usuario;
  }

  /** Restaura a sessão a partir do cookie de refresh (ex.: ao recarregar a página). */
  renovar(): Promise<Usuario | null> {
    this.renovando ??= this.bruto('POST', '/api/auth/renovar')
      .then((r) => {
        this.tokenAcesso = r.tokenAcesso;
        return r.usuario as Usuario;
      })
      .catch(() => {
        this.tokenAcesso = null;
        return null;
      })
      .finally(() => {
        this.renovando = null;
      });
    return this.renovando;
  }

  async sair() {
    await this.requisitar('POST', '/api/auth/logout').catch(() => undefined);
    this.tokenAcesso = null;
    this.notificar(null);
  }

  /** Requisição autenticada; renova o token uma vez em caso de 401. */
  async requisitar<T = any>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    try {
      return await this.bruto(metodo, caminho, corpo, this.tokenAcesso);
    } catch (e) {
      if (!(e instanceof ErroApi) || e.status !== 401) throw e;
      const usuario = await this.renovar();
      if (!usuario) {
        this.notificar(null);
        throw e;
      }
      return this.bruto(metodo, caminho, corpo, this.tokenAcesso);
    }
  }

  publico<T = any>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    return this.bruto(metodo, caminho, corpo);
  }

  private async bruto(metodo: string, caminho: string, corpo?: unknown, token?: string | null) {
    const r = await fetch(caminho, {
      method: metodo,
      credentials: 'same-origin',
      headers: {
        ...(corpo !== undefined && { 'content-type': 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 204) return undefined;
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new ErroApi(r.status, json.mensagem ?? 'Não foi possível concluir a operação.', json.campos ?? {});
    }
    return json;
  }

  private notificar(u: Usuario | null) {
    this.ouvintes.forEach((f) => f(u));
  }
}

export const api = new ClienteApi();

// ---- Tipos das respostas usadas pelas telas ----------------------------------------------

export type StatusRegistro =
  | 'INICIADO' | 'CREDITOS_RESERVADOS' | 'AGUARDANDO_SESSAO' | 'EM_CAPTURA' | 'SELANDO'
  | 'CONCLUIDO' | 'RECUSADO' | 'FALHOU' | 'CANCELADO';

export interface ItemRegistro {
  id: string;
  titulo: string;
  url: string;
  tipo: 'TELA' | 'VIDEO';
  status: StatusRegistro;
  motivoFalha?: string;
  inicio: string;
  fim?: string;
  quantidadeImagens?: number;
  quantidadeVideos?: number;
}

export interface ListaRegistros {
  itens: ItemRegistro[];
  total: number;
  pagina: number;
  tamanho: number;
  contadores: { concluidos: number; emAndamento: number };
}

export interface Saldo {
  disponivel: number;
  reservado: number;
}
