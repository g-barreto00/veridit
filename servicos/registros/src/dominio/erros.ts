export abstract class ErroDominio extends Error {
  constructor(mensagem: string, readonly detalhes?: Record<string, unknown>) {
    super(mensagem);
    this.name = new.target.name;
  }
}

export class ErroValidacao extends ErroDominio {}
export class ErroNaoEncontrado extends ErroDominio {}
export class ErroEstado extends ErroDominio {}
export class ErroSemSaldo extends ErroDominio {}
export class ErroLimiteSessoes extends ErroDominio {}
export class ErroIndisponivel extends ErroDominio {}
