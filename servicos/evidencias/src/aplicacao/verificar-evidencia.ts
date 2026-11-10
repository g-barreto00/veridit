import { verify } from 'node:crypto';
import { sha256 } from '../dominio/manifesto';
import type { ArmazenamentoEvidencias, CarimboTempo, RepositorioEvidencias } from '../dominio/portas';

/**
 * Verificação de uma evidência selada a partir do que está no armazenamento WORM: recalcula os
 * hashes, confere a assinatura com a chave pública e confere o carimbo do tempo. É o cenário da
 * ADR-0001: "a alteração de qualquer byte de um arquivo do pacote é detectada".
 */
export class VerificarEvidencia {
  constructor(
    private readonly evidencias: RepositorioEvidencias,
    private readonly armazenamento: ArmazenamentoEvidencias,
    private readonly carimbo: CarimboTempo,
  ) {}

  async executar(usuarioId: string, registroId: string) {
    const e = await this.evidencias.buscar(registroId);
    if (!e || e.usuarioId !== usuarioId) return undefined;

    const p = e.prefixoWorm;
    // Lê sempre a versão exata que foi selada (protegida pelo Object Lock).
    const ler = (chave: string) => this.armazenamento.lerImutavel(chave, e.versoesWorm[chave]);
    const [manifesto, assinatura, tsr, chavePublica] = await Promise.all(
      ['manifesto.json', 'manifesto.sig', 'manifesto.tsr', 'chave-publica.pem'].map((n) => ler(p + n)),
    );
    const digest = sha256(manifesto);
    const listaManifesto = JSON.parse(manifesto.toString('utf8')).arquivos as { nome: string; sha256: string }[];

    const arquivos = await Promise.all(
      listaManifesto.map(async (a) => {
        const conteudo = await ler(p + a.nome).catch(() => undefined);
        return { nome: a.nome, integro: !!conteudo && sha256(conteudo).toString('hex') === a.sha256 };
      }),
    );
    const carimbo = this.carimbo.conferir(tsr, digest);

    const verificacao = {
      manifestoIntegro: digest.toString('hex') === e.hashManifesto,
      assinaturaValida: verify('sha256', manifesto, { key: chavePublica.toString(), dsaEncoding: 'der' }, assinatura),
      carimboConfere: carimbo.confere,
      arquivosIntegros: arquivos.every((a) => a.integro),
    };

    return {
      registroId: e.registroId,
      hashManifesto: e.hashManifesto,
      seladaEm: e.seladaEm,
      assinatura: { algoritmo: e.algoritmoAssinatura, chave: e.chaveAssinatura },
      carimbo: { autoridade: e.carimboTsa, horario: carimbo.horario ?? e.carimboHorario },
      quantidadeImagens: e.quantidadeImagens,
      quantidadeVideos: e.quantidadeVideos,
      arquivos: e.arquivos.map(({ nome, tipo, tamanhoBytes, sha256, capturadoEm, url }) => ({
        nome, tipo, tamanhoBytes, sha256, capturadoEm, url,
        integro: arquivos.find((a) => a.nome === nome)?.integro ?? false,
      })),
      verificacao: { ...verificacao, valida: Object.values(verificacao).every(Boolean) },
    };
  }
}
