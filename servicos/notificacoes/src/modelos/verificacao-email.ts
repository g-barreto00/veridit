import type { UsuarioCadastrado } from '@veridit/contratos';
import type { Email, ModeloEmail } from '../portas';

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** E-mail de confirmação de cadastro (ADR-0005: verificação de e-mail). */
export class ModeloVerificacaoEmail implements ModeloEmail<UsuarioCadastrado> {
  constructor(private readonly urlWeb: string) {}

  montar(evento: UsuarioCadastrado): Email {
    const { nome, email, tokenVerificacao } = evento.dados;
    const link = `${this.urlWeb}/verificar-email?token=${encodeURIComponent(tokenVerificacao)}`;
    const primeiroNome = nome.split(' ')[0];
    return {
      para: email,
      assunto: 'Confirme seu e-mail no Veridit',
      texto: `Olá, ${primeiroNome}!\n\nPara ativar sua conta no Veridit, acesse:\n${link}\n\nO link vale por 24 horas. Se você não criou esta conta, ignore este e-mail.`,
      html: `<p>Olá, ${escapar(primeiroNome)}!</p>
<p>Para ativar sua conta no Veridit, confirme seu e-mail:</p>
<p><a href="${escapar(link)}">Confirmar e-mail</a></p>
<p>O link vale por 24 horas. Se você não criou esta conta, ignore este e-mail.</p>`,
    };
  }
}
