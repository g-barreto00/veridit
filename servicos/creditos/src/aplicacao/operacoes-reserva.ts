import { SaldoInsuficiente } from '../dominio/carteira';
import { ErroEstado, ErroNaoEncontrado, ErroSaldoInsuficiente, ErroValidacao } from '../dominio/erros';
import type { PoliticaConsumo, RepositorioReservas, Relogio, Reserva } from '../dominio/portas';
import type { UnidadeCarteira } from './unidade-carteira';

/** Validade da reserva: duração máxima da sessão (30 min, ADR-0003) + margem para selagem. */
export const VALIDADE_RESERVA_MS = 60 * 60 * 1000;

const visao = (r: Reserva) => ({
  chave: r.chave,
  usuarioId: r.usuarioId,
  tipoRegistro: r.tipoRegistro,
  creditos: r.creditos,
  estado: r.estado,
  expiraEm: r.expiraEm,
});

/**
 * Reserva créditos ao iniciar um registro (REQ08). Chamada síncrona do serviço de Registros
 * (ADR-0008). Idempotente pela chave (id do registro).
 */
export class ReservarCreditos {
  constructor(
    private readonly unidade: UnidadeCarteira,
    private readonly reservas: RepositorioReservas,
    private readonly politica: PoliticaConsumo,
    private readonly relogio: Relogio,
  ) {}

  async executar(usuarioId: string, chave: string, tipoRegistro: string) {
    if (!usuarioId || !chave) throw new ErroValidacao('usuarioId e chave são obrigatórios');
    const creditos = await this.politica.creditosPara(tipoRegistro);
    if (!creditos) throw new ErroValidacao(`Tipo de registro desconhecido: ${tipoRegistro}`);

    return this.unidade.executar(async (tx) => {
      const existente = await this.reservas.buscar(tx, chave);
      if (existente) {
        if (existente.usuarioId !== usuarioId) throw new ErroEstado('Chave de reserva pertence a outro usuário');
        return visao(existente);
      }

      const carteira = await this.unidade.carregar(tx, usuarioId);
      try {
        carteira.aplicar(this.unidade.lancamento(usuarioId, 'RESERVA', creditos, chave, `Reserva para registro ${tipoRegistro}`));
      } catch (e) {
        if (e instanceof SaldoInsuficiente) {
          throw new ErroSaldoInsuficiente('Saldo de créditos insuficiente', {
            necessario: e.necessario,
            disponivel: e.disponivel,
          });
        }
        throw e;
      }

      const agora = this.relogio.agora();
      const reserva: Reserva = {
        chave,
        usuarioId,
        tipoRegistro,
        creditos,
        estado: 'ATIVA',
        expiraEm: new Date(agora.getTime() + VALIDADE_RESERVA_MS),
        criadaEm: agora,
      };
      await this.reservas.inserir(tx, reserva);
      await this.unidade.salvar(tx, carteira);
      return visao(reserva);
    });
  }
}

/** Converte a reserva em consumo quando o registro é selado (ADR-0008). Idempotente. */
export class ConsumirReserva {
  constructor(
    private readonly unidade: UnidadeCarteira,
    private readonly reservas: RepositorioReservas,
    private readonly relogio: Relogio,
  ) {}

  async executar(chave: string) {
    return this.unidade.executar(async (tx) => {
      const reserva = await this.reservas.buscar(tx, chave);
      if (!reserva) throw new ErroNaoEncontrado('Reserva não encontrada');
      if (reserva.estado === 'CONSUMIDA') return visao(reserva);
      if (reserva.estado === 'ESTORNADA') throw new ErroEstado('Reserva já foi estornada');

      const carteira = await this.unidade.carregar(tx, reserva.usuarioId);
      carteira.aplicar(this.unidade.lancamento(reserva.usuarioId, 'CONSUMO', reserva.creditos, chave, 'Registro concluído'));
      await this.reservas.finalizar(tx, chave, 'CONSUMIDA', this.relogio.agora());
      await this.unidade.salvar(tx, carteira);
      return visao({ ...reserva, estado: 'CONSUMIDA' });
    });
  }
}

/**
 * Devolve os créditos reservados (falha, cancelamento ou expiração). É a compensação da saga
 * (ADR-0007), por isso estornar uma reserva inexistente não é erro.
 */
export class EstornarReserva {
  constructor(
    private readonly unidade: UnidadeCarteira,
    private readonly reservas: RepositorioReservas,
    private readonly relogio: Relogio,
  ) {}

  async executar(chave: string, motivo = 'Registro não concluído') {
    return this.unidade.executar(async (tx) => {
      const reserva = await this.reservas.buscar(tx, chave);
      if (!reserva) return undefined;
      if (reserva.estado === 'ESTORNADA') return visao(reserva);
      if (reserva.estado === 'CONSUMIDA') throw new ErroEstado('Reserva já foi consumida');

      const carteira = await this.unidade.carregar(tx, reserva.usuarioId);
      carteira.aplicar(this.unidade.lancamento(reserva.usuarioId, 'ESTORNO_RESERVA', reserva.creditos, chave, motivo));
      await this.reservas.finalizar(tx, chave, 'ESTORNADA', this.relogio.agora());
      await this.unidade.salvar(tx, carteira);
      return visao({ ...reserva, estado: 'ESTORNADA' });
    });
  }
}
