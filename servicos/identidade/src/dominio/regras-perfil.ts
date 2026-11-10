import type { DadosCadastro, Perfil } from './usuario';

/**
 * D1: o sistema terá advogados, usuários comuns e, futuramente, empresas, cada um com
 * campos próprios. Cada perfil é uma regra separada (SOLID: aberto/fechado) — incluir
 * EMPRESA na próxima versão = criar uma nova classe e registrá-la, sem alterar o cadastro.
 */
export interface RegraPerfil {
  readonly perfil: Perfil;
  /** Retorna erros por campo; objeto vazio = válido. */
  validar(dados: DadosCadastro): Record<string, string>;
  /** Normaliza os campos específicos do perfil. */
  camposEspecificos(dados: DadosCadastro): { numeroOab?: string };
}

export class RegraUsuarioComum implements RegraPerfil {
  readonly perfil = 'COMUM' as const;
  validar(): Record<string, string> {
    return {};
  }
  camposEspecificos() {
    return {};
  }
}

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

export class RegraAdvogado implements RegraPerfil {
  readonly perfil = 'ADVOGADO' as const;

  validar(dados: DadosCadastro): Record<string, string> {
    const oab = this.normalizarOab(dados.numeroOab);
    if (!oab) return { numeroOab: 'Informe o número da OAB no formato UF 123456' };
    return {};
  }

  camposEspecificos(dados: DadosCadastro) {
    return { numeroOab: this.normalizarOab(dados.numeroOab) };
  }

  /** Aceita "BA 12345", "ba12345", "12345/BA" → "BA 12345". */
  private normalizarOab(valor?: string): string | undefined {
    const v = (valor ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
    const m = v.match(/^([A-Z]{2})\s?\/?\s?(\d{1,6})$/) ?? v.match(/^(\d{1,6})\s?\/?\s?([A-Z]{2})$/);
    if (!m) return undefined;
    const [uf, numero] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    return UFS.includes(uf) ? `${uf} ${numero}` : undefined;
  }
}

/** Catálogo dos perfis habilitados nesta versão (D1: empresas ainda não são cadastradas). */
export class CatalogoPerfis {
  private readonly regras: Map<string, RegraPerfil>;
  constructor(regras: RegraPerfil[]) {
    this.regras = new Map(regras.map((r) => [r.perfil, r]));
  }
  obter(perfil: string): RegraPerfil | undefined {
    return this.regras.get(perfil);
  }
  habilitados(): Perfil[] {
    return [...this.regras.keys()] as Perfil[];
  }
}
