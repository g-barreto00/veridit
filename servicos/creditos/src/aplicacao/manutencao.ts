import type { Registrador } from '@veridit/mensageria';
import type { ConsultaInvariantes, RepositorioReservas, Relogio } from '../dominio/portas';
import type { EstornarReserva } from './operacoes-reserva';

/** Gerenciador de Reservas (C09): estorna reservas vencidas para não prenderem créditos. */
export class ExpirarReservas {
  constructor(
    private readonly reservas: RepositorioReservas,
    private readonly estornar: EstornarReserva,
    private readonly relogio: Relogio,
    private readonly log: Registrador,
  ) {}

  async executar(): Promise<number> {
    const chaves = await this.reservas.expiradas(this.relogio.agora(), 100);
    let estornadas = 0;
    for (const chave of chaves) {
      try {
        await this.estornar.executar(chave, 'Reserva expirada');
        estornadas++;
      } catch (e) {
        // Ex.: foi consumida entre a consulta e o estorno — nada a fazer.
        this.log.warn('não foi possível expirar reserva', { chave, erro: String(e) });
      }
    }
    if (estornadas) this.log.info('reservas expiradas estornadas', { estornadas });
    return estornadas;
  }
}

/** Verificador de Invariantes (C09): saldo materializado = soma dos lançamentos. */
export class VerificarInvariantes {
  constructor(
    private readonly consulta: ConsultaInvariantes,
    private readonly log: Registrador,
  ) {}

  async executar() {
    const divergencias = await this.consulta.divergencias();
    for (const d of divergencias) {
      this.log.error('INVARIANTE VIOLADA: saldo da carteira difere do livro-razão', { ...d });
    }
    return divergencias;
  }
}
