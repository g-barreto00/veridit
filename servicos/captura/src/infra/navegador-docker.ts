import Docker from 'dockerode';
import { chromium } from 'playwright-core';
import type { Registrador } from '@veridit/mensageria';
import type { FabricaNavegadores, NavegadorEfemero } from '../portas';

export interface ConfigNavegadorDocker {
  imagem: string;
  /** Rede só com saída para a internet (ADR-0003, opção b). */
  redeCaptura: string;
  workerId: string;
  memoriaBytes: number;
  cpus: number;
}

/**
 * Um contêiner Chromium por sessão, ligado SOMENTE à rede-captura. Sem cookies, cache ou
 * disco persistentes: o contêiner é removido ao fim da sessão (ADR-0003).
 */
export class FabricaNavegadoresDocker implements FabricaNavegadores {
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });

  constructor(
    private readonly config: ConfigNavegadorDocker,
    private readonly log: Registrador,
  ) {}

  async criar(sessaoId: string): Promise<NavegadorEfemero> {
    const nome = `veridit-nav-${sessaoId.slice(0, 12)}`;
    const conteiner = await this.docker.createContainer({
      name: nome,
      Image: this.config.imagem,
      Labels: { 'veridit.worker': this.config.workerId, 'veridit.sessao': sessaoId },
      HostConfig: {
        NetworkMode: this.config.redeCaptura,
        AutoRemove: true,
        Init: true,
        Memory: this.config.memoriaBytes,
        NanoCpus: Math.round(this.config.cpus * 1e9),
        ShmSize: 512 * 1024 * 1024,
        SecurityOpt: ['no-new-privileges'],
        CapDrop: ['ALL'],
        PidsLimit: 512,
      },
    });
    await conteiner.start();

    const destruir = async () => {
      await conteiner.remove({ force: true }).catch(() => undefined);
    };

    try {
      const info = await conteiner.inspect();
      const ip = info.NetworkSettings.Networks[this.config.redeCaptura]?.IPAddress ?? '';
      const navegador = await this.conectar(`ws://${nome}:3000/`);
      return { navegador, ip, destruir };
    } catch (e) {
      await destruir();
      throw e;
    }
  }

  async limparOrfaos(): Promise<number> {
    const orfaos = await this.docker.listContainers({
      all: true,
      filters: { label: [`veridit.worker=${this.config.workerId}`] },
    });
    for (const c of orfaos) await this.docker.getContainer(c.Id).remove({ force: true }).catch(() => undefined);
    if (orfaos.length) this.log.warn('navegadores órfãos removidos', { quantidade: orfaos.length });
    return orfaos.length;
  }

  /** O run-server leva alguns segundos para subir: tenta conectar até ficar pronto. */
  private async conectar(endpoint: string) {
    let ultimoErro: unknown;
    for (let i = 0; i < 40; i++) {
      try {
        return await chromium.connect(endpoint, { timeout: 5000 });
      } catch (e) {
        ultimoErro = e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error(`Navegador não ficou pronto: ${String(ultimoErro)}`);
  }
}

/**
 * Descobre o endereço deste worker na rede interna (por onde o gateway encaminha o WebSocket).
 * O hostname do contêiner é o id dele no Docker.
 */
export async function enderecoNaRede(rede: string, hostname: string): Promise<string> {
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  const info = await docker.getContainer(hostname).inspect();
  const ip = info.NetworkSettings.Networks[rede]?.IPAddress;
  if (!ip) throw new Error(`Worker não está na rede ${rede}`);
  return ip;
}
