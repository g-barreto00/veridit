import type { Pool } from 'pg';
import type { Registrador } from '@veridit/mensageria';
import { ConsultarCarteira } from './aplicacao/consultar-carteira';
import { CreditarCarteira } from './aplicacao/creditar';
import { ExpirarReservas, VerificarInvariantes } from './aplicacao/manutencao';
import { ConsumirReserva, EstornarReserva, ReservarCreditos } from './aplicacao/operacoes-reserva';
import { UnidadeCarteira } from './aplicacao/unidade-carteira';
import type { Relogio } from './dominio/portas';
import {
  ConsultaInvariantesPg,
  ExecutorTransacaoPg,
  PoliticaConsumoPg,
  RelogioSistema,
  RepositorioCarteirasPg,
  RepositorioReservasPg,
} from './infra/repositorios-pg';

/** Monta os casos de uso com as implementações concretas. Usado pelo main e pelos testes de integração. */
export function comporCreditos(pool: Pool, log: Registrador, relogio: Relogio = new RelogioSistema()) {
  const carteiras = new RepositorioCarteirasPg();
  const reservas = new RepositorioReservasPg(pool);
  const unidade = new UnidadeCarteira(new ExecutorTransacaoPg(pool), carteiras, relogio);
  const estornar = new EstornarReserva(unidade, reservas, relogio);
  return {
    reservar: new ReservarCreditos(unidade, reservas, new PoliticaConsumoPg(pool), relogio),
    consumir: new ConsumirReserva(unidade, reservas, relogio),
    estornar,
    creditar: new CreditarCarteira(unidade, carteiras),
    consultar: new ConsultarCarteira(pool),
    expirar: new ExpirarReservas(reservas, estornar, relogio, log),
    invariantes: new VerificarInvariantes(new ConsultaInvariantesPg(pool), log),
  };
}
