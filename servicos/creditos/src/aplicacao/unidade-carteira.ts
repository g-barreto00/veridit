import { randomUUID } from 'node:crypto';
import type { Carteira, Lancamento, TipoLancamento } from '../dominio/carteira';
import {
  ConflitoConcorrencia,
  type ExecutorTransacao,
  type RepositorioCarteiras,
  type Relogio,
  type Transacao,
} from '../dominio/portas';

const MAX_TENTATIVAS = 8;

/**
 * Executa uma operação na carteira em transação, com retentativa em caso de conflito de
 * concorrência otimista. Compartilhado pelos casos de uso (reservar, consumir, estornar, creditar).
 */
export class UnidadeCarteira {
  constructor(
    private readonly transacao: ExecutorTransacao,
    private readonly carteiras: RepositorioCarteiras,
    private readonly relogio: Relogio,
  ) {}

  async executar<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        return await this.transacao.executar(fn);
      } catch (e) {
        if (!(e instanceof ConflitoConcorrencia) || tentativa >= MAX_TENTATIVAS) throw e;
        // Pequena espera aleatória para desfazer a disputa.
        await new Promise((r) => setTimeout(r, Math.random() * 10 * tentativa));
      }
    }
  }

  async carregar(tx: Transacao, usuarioId: string): Promise<Carteira> {
    await this.carteiras.garantir(tx, usuarioId);
    return (await this.carteiras.carregar(tx, usuarioId))!;
  }

  lancamento(usuarioId: string, tipo: TipoLancamento, creditos: number, chave: string, descricao?: string): Lancamento {
    return {
      id: randomUUID(),
      usuarioId,
      tipo,
      creditos,
      chaveIdempotencia: chave,
      descricao,
      criadoEm: this.relogio.agora(),
    };
  }

  salvar(tx: Transacao, carteira: Carteira) {
    return this.carteiras.salvar(tx, carteira);
  }
}
