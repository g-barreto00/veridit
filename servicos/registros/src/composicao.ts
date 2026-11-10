import type { Pool } from 'pg';
import type { Registrador } from '@veridit/mensageria';
import { ConsultarRegistros } from './aplicacao/consultar-registros';
import { CoordenadorSaga } from './aplicacao/coordenador-saga';
import { IniciarRegistro } from './aplicacao/iniciar-registro';
import type { AlocadorSessao, CarteiraCreditos, Relogio } from './dominio/portas';
import {
  ExecutorTransacaoPg,
  RegistradorEventosOutbox,
  RelogioSistema,
  RepositorioRegistrosPg,
} from './infra/repositorio-registros-pg';

/** Monta os casos de uso. Carteira e alocador entram por parâmetro para os testes trocarem por dublês. */
export function comporRegistros(
  pool: Pool,
  carteira: CarteiraCreditos,
  alocador: AlocadorSessao,
  log: Registrador,
  relogio: Relogio = new RelogioSistema(),
) {
  const registros = new RepositorioRegistrosPg(pool);
  const transacao = new ExecutorTransacaoPg(pool);
  const eventos = new RegistradorEventosOutbox();
  return {
    iniciar: new IniciarRegistro(registros, carteira, eventos, transacao, relogio),
    saga: new CoordenadorSaga(registros, carteira, alocador, eventos, transacao, relogio, log),
    consultar: new ConsultarRegistros(pool),
  };
}
