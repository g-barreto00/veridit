/** Erros de domínio. A camada HTTP traduz cada tipo para um status (ver http/filtro-erros.ts). */
export abstract class ErroDominio extends Error {
  constructor(mensagem: string, readonly detalhes?: Record<string, string>) {
    super(mensagem);
    this.name = new.target.name;
  }
}

export class ErroValidacao extends ErroDominio {}
export class ErroConflito extends ErroDominio {}
export class ErroCredenciais extends ErroDominio {}
export class ErroAcessoNegado extends ErroDominio {}
export class ErroContaBloqueada extends ErroDominio {
  constructor(readonly bloqueadoAte: Date) {
    super('Muitas tentativas de login. Tente novamente mais tarde.');
  }
}
