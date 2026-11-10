export interface Email {
  para: string;
  assunto: string;
  texto: string;
  html: string;
}

/** Porta de envio. Hoje SMTP (Mailpit em desenvolvimento); pode virar SES, SendGrid etc. */
export interface EnviadorEmail {
  enviar(email: Email): Promise<void>;
}

/**
 * Cada modelo de e-mail sabe montar a mensagem de um tipo de evento (SOLID: aberto/fechado).
 * Na sprint 2 entram os modelos de PagamentoConfirmado (REQ07) e RegistroConcluido (REQ10/REQ11-B).
 */
export interface ModeloEmail<E> {
  montar(evento: E): Email;
}
