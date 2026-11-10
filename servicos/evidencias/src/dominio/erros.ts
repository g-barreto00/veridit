/** Falha que não adianta repetir (ex.: origem não autêntica, arquivo adulterado). */
export class FalhaDefinitiva extends Error {}

export class OrigemNaoAutentica extends FalhaDefinitiva {
  constructor() {
    super('Evento de captura sem assinatura de origem válida');
  }
}

export class ArquivoDivergente extends FalhaDefinitiva {
  constructor(nome: string, esperado: string, obtido: string) {
    super(`Arquivo ${nome} foi alterado após a captura (esperado ${esperado.slice(0, 12)}…, obtido ${obtido.slice(0, 12)}…)`);
  }
}
