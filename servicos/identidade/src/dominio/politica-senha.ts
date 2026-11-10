/** Política mínima de senha (ADR-0005; mínimo de 10 caracteres, como na tela 02 do protótipo). */
export function violacoesSenha(senha: string): string[] {
  const v: string[] = [];
  if (!senha || senha.length < 10) v.push('ter pelo menos 10 caracteres');
  if (senha && senha.length > 128) v.push('ter no máximo 128 caracteres');
  if (!/[A-Za-z]/.test(senha ?? '')) v.push('conter ao menos uma letra');
  if (!/\d/.test(senha ?? '')) v.push('conter ao menos um número');
  return v;
}
