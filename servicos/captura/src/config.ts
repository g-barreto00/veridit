/** Configuração por variáveis de ambiente (sem depender de @veridit/plataforma, que traz o driver pg). */
export function env(nome: string, padrao?: string): string {
  const valor = process.env[nome] ?? padrao;
  if (valor === undefined || valor === '') throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  return valor;
}

export function envNumero(nome: string, padrao?: number): number {
  const valor = Number(env(nome, padrao?.toString()));
  if (Number.isNaN(valor)) throw new Error(`Variável ${nome} deveria ser numérica`);
  return valor;
}
