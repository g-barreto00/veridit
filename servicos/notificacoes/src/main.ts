import type { UsuarioCadastrado } from '@veridit/contratos';
import { ConsumidorEventos, GuardaSemEstado, conectarBroker, registradorConsole } from '@veridit/mensageria';
import { env } from '@veridit/plataforma';
import { EnviadorSmtp } from './enviador-smtp';
import { ModeloVerificacaoEmail } from './modelos/verificacao-email';

/**
 * Notificações não tem esquema próprio no banco (ADR-0010 lista identidade, creditos,
 * registros, evidencias e auditoria). Por isso usa a guarda sem estado: em caso de
 * reentrega, o pior efeito é um e-mail repetido.
 */
async function iniciar() {
  const enviador = new EnviadorSmtp(env('SMTP_URL'), env('EMAIL_REMETENTE', 'Veridit <nao-responda@veridit.local>'));
  const verificacao = new ModeloVerificacaoEmail(env('URL_WEB'));

  const consumidor = new ConsumidorEventos(conectarBroker(env('AMQP_URL')), {
    fila: 'notificacoes',
    guarda: new GuardaSemEstado(),
    manipuladores: {
      UsuarioCadastrado: async (evento: UsuarioCadastrado) => {
        await enviador.enviar(verificacao.montar(evento));
        registradorConsole.info('e-mail de verificação enviado', { usuarioId: evento.dados.usuarioId });
      },
    },
  });
  await consumidor.iniciar();
  registradorConsole.info('notificações no ar');
}

iniciar().catch((e) => {
  console.error(e);
  process.exit(1);
});
