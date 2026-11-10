import type { Browser } from 'playwright-core';

/**
 * Portas do Motor de Captura (C12). O worker não acessa banco (ADR-0002/ADR-0009): fala só
 * com o broker, com o armazenamento de objetos e com o navegador efêmero.
 */

/** Navegador isolado de uma sessão; destruir() remove o contêiner e tudo que ele guardou. */
export interface NavegadorEfemero {
  navegador: Browser;
  /** IP do contêiner na rede-captura (identifica as conexões dele no proxy de saída). */
  ip: string;
  destruir(): Promise<void>;
}

/** Cria um navegador em ambiente isolado para cada sessão (ADR-0003). */
export interface FabricaNavegadores {
  criar(sessaoId: string): Promise<NavegadorEfemero>;
  /** Remove navegadores órfãos deste worker (ex.: após reinício). */
  limparOrfaos(): Promise<number>;
}

/** Bucket captura-temporaria (ADR-0010). */
export interface ArmazenamentoTemporario {
  enviar(chave: string, conteudo: Buffer, tipoConteudo: string): Promise<void>;
}

/** Horário de referência obtido de servidor NTP (ADR-0003: horário sincronizado por NTP). */
export interface RelogioNtp {
  agora(): Promise<{ horario: Date; fonte: string } | undefined>;
}

/** Conexões que o proxy de saída fez em nome de um navegador (host → IP real). */
export interface RegistroConexoes {
  conexoes(ipNavegador: string): Promise<{ host: string; ip: string; porta: number; em: string }[]>;
}

export interface ResolvedorDns {
  resolver(hostname: string): Promise<string[]>;
}
