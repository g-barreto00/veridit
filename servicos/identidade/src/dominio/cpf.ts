/** Normaliza (só dígitos) e valida CPF pelos dígitos verificadores. */
export function normalizarCpf(cpf: string): string {
  return (cpf ?? '').replace(/\D/g, '');
}

export function cpfValido(cpf: string): boolean {
  const d = normalizarCpf(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (base: string, pesoInicial: number) => {
    const soma = [...base].reduce((acc, n, i) => acc + Number(n) * (pesoInicial - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(d.slice(0, 9), 10) === Number(d[9]) && digito(d.slice(0, 10), 11) === Number(d[10]);
}
