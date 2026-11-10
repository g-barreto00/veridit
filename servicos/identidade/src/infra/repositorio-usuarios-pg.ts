import type { Pool } from 'pg';
import type { CriptografiaCampo } from '@veridit/plataforma';
import type { RepositorioUsuarios, Transacao } from '../dominio/portas';
import type { Perfil, Usuario } from '../dominio/usuario';
import { cliente } from './transacao-pg';

interface LinhaUsuario {
  id: string;
  perfil: Perfil;
  nome: string;
  email: string;
  senha_hash: string;
  cpf_cifrado: string;
  numero_oab: string | null;
  email_verificado_em: Date | null;
  falhas_login: number;
  bloqueado_ate: Date | null;
  criado_em: Date;
}

/** Usuários em PostgreSQL. O CPF é cifrado/decifrado aqui, de forma transparente ao domínio (ADR-0010). */
export class RepositorioUsuariosPg implements RepositorioUsuarios {
  constructor(
    private readonly pool: Pool,
    private readonly cripto: CriptografiaCampo,
  ) {}

  async buscarPorEmail(email: string) {
    const { rows } = await this.pool.query<LinhaUsuario>('SELECT * FROM usuarios WHERE email = $1', [email]);
    return rows[0] && this.paraDominio(rows[0]);
  }

  async buscarPorId(id: string) {
    const { rows } = await this.pool.query<LinhaUsuario>('SELECT * FROM usuarios WHERE id = $1', [id]);
    return rows[0] && this.paraDominio(rows[0]);
  }

  async emailEmUso(email: string) {
    return (await this.pool.query('SELECT 1 FROM usuarios WHERE email = $1', [email])).rowCount! > 0;
  }

  async cpfEmUso(cpf: string) {
    const indice = this.cripto.indiceBusca(cpf);
    return (await this.pool.query('SELECT 1 FROM usuarios WHERE cpf_indice = $1', [indice])).rowCount! > 0;
  }

  async oabEmUso(numeroOab: string) {
    return (await this.pool.query('SELECT 1 FROM usuarios WHERE numero_oab = $1', [numeroOab])).rowCount! > 0;
  }

  async inserir(tx: Transacao, u: Usuario) {
    await cliente(tx).query(
      `INSERT INTO usuarios (id, perfil, nome, email, senha_hash, cpf_cifrado, cpf_indice, numero_oab, criado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        u.id,
        u.perfil,
        u.nome,
        u.email,
        u.senhaHash,
        this.cripto.cifrar(u.cpf),
        this.cripto.indiceBusca(u.cpf),
        u.numeroOab ?? null,
        u.criadoEm,
      ],
    );
  }

  async registrarFalhaLogin(id: string, falhas: number, bloqueadoAte?: Date) {
    await this.pool.query('UPDATE usuarios SET falhas_login = $2, bloqueado_ate = $3 WHERE id = $1', [
      id,
      falhas,
      bloqueadoAte ?? null,
    ]);
  }

  async zerarFalhasLogin(id: string) {
    await this.pool.query('UPDATE usuarios SET falhas_login = 0, bloqueado_ate = NULL WHERE id = $1', [id]);
  }

  async marcarEmailVerificado(tx: Transacao, id: string, quando: Date) {
    await cliente(tx).query(
      'UPDATE usuarios SET email_verificado_em = COALESCE(email_verificado_em, $2) WHERE id = $1',
      [id, quando],
    );
  }

  private paraDominio(l: LinhaUsuario): Usuario {
    return {
      id: l.id,
      perfil: l.perfil,
      nome: l.nome,
      email: l.email,
      senhaHash: l.senha_hash,
      cpf: this.cripto.decifrar(l.cpf_cifrado),
      numeroOab: l.numero_oab ?? undefined,
      emailVerificadoEm: l.email_verificado_em ?? undefined,
      falhasLogin: l.falhas_login,
      bloqueadoAte: l.bloqueado_ate ?? undefined,
      criadoEm: l.criado_em,
    };
  }
}
