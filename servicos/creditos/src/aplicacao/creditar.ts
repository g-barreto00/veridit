import { ErroValidacao } from '../dominio/erros';
import type { RepositorioCarteiras } from '../dominio/portas';
import type { UnidadeCarteira } from './unidade-carteira';

/**
 * Adiciona créditos à carteira:
 * - CREDITO_COMPRA: pagamento confirmado (REQ05/REQ06, sprint 2), chave = id do pagamento;
 * - AJUSTE: créditos de boas-vindas no cadastro (premissa da sprint 1), chave = id do usuário.
 * Idempotente: a mesma (tipo, chave) só tem efeito uma vez.
 */
export class CreditarCarteira {
  constructor(
    private readonly unidade: UnidadeCarteira,
    private readonly carteiras: RepositorioCarteiras,
  ) {}

  async executar(entrada: {
    usuarioId: string;
    tipo: 'CREDITO_COMPRA' | 'AJUSTE';
    creditos: number;
    chave: string;
    descricao: string;
  }): Promise<'creditado' | 'ja_creditado'> {
    if (!Number.isInteger(entrada.creditos) || entrada.creditos === 0) {
      throw new ErroValidacao('Quantidade de créditos inválida');
    }
    if (entrada.tipo === 'CREDITO_COMPRA' && entrada.creditos < 0) {
      throw new ErroValidacao('Compra não pode ter créditos negativos');
    }
    return this.unidade.executar(async (tx) => {
      if (await this.carteiras.lancamentoExiste(tx, entrada.tipo, entrada.chave)) return 'ja_creditado';
      const carteira = await this.unidade.carregar(tx, entrada.usuarioId);
      carteira.aplicar(
        this.unidade.lancamento(entrada.usuarioId, entrada.tipo, entrada.creditos, entrada.chave, entrada.descricao),
      );
      await this.unidade.salvar(tx, carteira);
      return 'creditado';
    });
  }
}
