import { randomUUID } from 'node:crypto';
import type { EventoVeridit } from '@veridit/contratos';

type DadosDe<T extends EventoVeridit['tipo']> = Extract<EventoVeridit, { tipo: T }>['dados'];

/** Fábrica de envelopes: centraliza id, versão, data e origem de todo evento emitido. */
export function criarEvento<T extends EventoVeridit['tipo']>(
  tipo: T,
  dados: DadosDe<T>,
  opcoes: { correlationId: string; origem: string; versao?: number },
): Extract<EventoVeridit, { tipo: T }> {
  return {
    id: randomUUID(),
    tipo,
    versao: opcoes.versao ?? 1,
    correlationId: opcoes.correlationId,
    ocorridoEm: new Date().toISOString(),
    origem: opcoes.origem,
    dados,
  } as Extract<EventoVeridit, { tipo: T }>;
}
