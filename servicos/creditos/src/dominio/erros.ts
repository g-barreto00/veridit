export abstract class ErroDominio extends Error {
  constructor(mensagem: string, readonly detalhes?: Record<string, unknown>) {
    super(mensagem);
    this.name = new.target.name;
  }
}

export class ErroValidacao extends ErroDominio {}
export class ErroNaoEncontrado extends ErroDominio {}
/** Operação incompatível com o estado atual (ex.: consumir reserva já estornada). */
export class ErroEstado extends ErroDominio {}
export class ErroSaldoInsuficiente extends ErroDominio {}
