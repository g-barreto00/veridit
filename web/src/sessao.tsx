import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Saldo, type Usuario } from './api/cliente';

interface Sessao {
  usuario: Usuario | null;
  carregando: boolean;
  saldo: Saldo | null;
  atualizarSaldo: () => void;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
}

const Contexto = createContext<Sessao | null>(null);

/** Completa o usuário com os dados do perfil (ex.: número da OAB, mostrado no cabeçalho). */
async function comPerfil(u: Usuario | null): Promise<Usuario | null> {
  if (!u) return null;
  return api.requisitar<Usuario>('GET', '/api/usuarios/me').catch(() => u);
}

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [saldo, setSaldo] = useState<Saldo | null>(null);

  useEffect(() => {
    const desligar = api.aoMudarSessao(setUsuario);
    void api.renovar().then(comPerfil).then((u) => {
      setUsuario(u);
      setCarregando(false);
    });
    return () => void desligar();
  }, []);

  const atualizarSaldo = useCallback(() => {
    if (!api.token) return;
    void api.requisitar<Saldo>('GET', '/api/creditos/saldo').then(setSaldo).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!usuario) return setSaldo(null);
    atualizarSaldo();
    const t = setInterval(atualizarSaldo, 15_000);
    return () => clearInterval(t);
  }, [usuario, atualizarSaldo]);

  const valor: Sessao = {
    usuario,
    carregando,
    saldo,
    atualizarSaldo,
    entrar: async (email, senha) => {
      setUsuario(await comPerfil(await api.entrar(email, senha)));
    },
    sair: () => api.sair(),
  };
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao() {
  const s = useContext(Contexto);
  if (!s) throw new Error('useSessao fora do ProvedorSessao');
  return s;
}
