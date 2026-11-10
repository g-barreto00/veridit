import nodemailer, { type Transporter } from 'nodemailer';
import type { Email, EnviadorEmail } from './portas';

export class EnviadorSmtp implements EnviadorEmail {
  private readonly transporte: Transporter;

  constructor(
    url: string,
    private readonly remetente: string,
  ) {
    this.transporte = nodemailer.createTransport(url);
  }

  async enviar(email: Email): Promise<void> {
    await this.transporte.sendMail({
      from: this.remetente,
      to: email.para,
      subject: email.assunto,
      text: email.texto,
      html: email.html,
    });
  }
}
