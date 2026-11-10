import type { RepositorioUsuarios } from '../dominio/portas';

/** Dados do usuário autenticado. Usado também pelos relatórios (REQ14: usuário e CPF). */
export class ConsultarUsuario {
  constructor(private readonly usuarios: RepositorioUsuarios) {}

  async executar(id: string) {
    const u = await this.usuarios.buscarPorId(id);
    if (!u) return undefined;
    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      perfil: u.perfil,
      numeroOab: u.numeroOab,
      // CPF mascarado: a interface não precisa do valor completo.
      cpf: `***.${u.cpf.slice(3, 6)}.${u.cpf.slice(6, 9)}-**`,
    };
  }
}
