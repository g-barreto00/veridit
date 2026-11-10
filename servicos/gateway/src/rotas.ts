/**
 * Tabela de roteamento do gateway (ADR-0002). Novos serviços entram aqui, sem alterar os
 * middlewares (SOLID: aberto/fechado).
 */
export interface Rota {
  prefixo: string;
  destino: string;
}

export interface RotaPublica {
  metodo: string;
  caminho: string;
}

/** Únicas rotas acessíveis sem token (ADR-0001: cadastro, login e recuperação de senha). */
export const ROTAS_PUBLICAS: RotaPublica[] = [
  { metodo: 'POST', caminho: '/api/auth/cadastro' },
  { metodo: 'POST', caminho: '/api/auth/login' },
  { metodo: 'POST', caminho: '/api/auth/renovar' },
  { metodo: 'POST', caminho: '/api/auth/verificar-email' },
  { metodo: 'GET', caminho: '/api/saude' },
];

/** Limites por IP nas rotas sensíveis a força bruta (ADR-0005). */
export const LIMITES_POR_IP: { caminho: string; maximo: number; janelaSegundos: number }[] = [
  { caminho: '/api/auth/login', maximo: 10, janelaSegundos: 60 },
  { caminho: '/api/auth/cadastro', maximo: 5, janelaSegundos: 60 },
  { caminho: '/api/auth/verificar-email', maximo: 10, janelaSegundos: 60 },
  { caminho: '/api/auth/renovar', maximo: 30, janelaSegundos: 60 },
];

export function rotaPublica(metodo: string, caminho: string): boolean {
  return ROTAS_PUBLICAS.some((r) => r.metodo === metodo && r.caminho === caminho);
}

export function resolverDestino(rotas: Rota[], caminho: string): Rota | undefined {
  return rotas.find((r) => caminho === r.prefixo || caminho.startsWith(`${r.prefixo}/`));
}
