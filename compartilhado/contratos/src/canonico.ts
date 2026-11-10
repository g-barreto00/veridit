/**
 * Serialização JSON canônica (chaves em ordem alfabética, sem espaços). Usada onde dois
 * serviços precisam produzir exatamente os mesmos bytes: assinatura de origem dos eventos de
 * captura e manifesto das evidências (ADR-0004).
 */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map((v) => jsonCanonico(v === undefined ? null : v)).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(obj[k])}`)
    .join(',')}}`;
}
