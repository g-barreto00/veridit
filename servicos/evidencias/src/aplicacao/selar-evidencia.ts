import type { CapturaConcluida } from '@veridit/contratos';
import { criarEvento } from '@veridit/mensageria';
import { ArquivoDivergente, OrigemNaoAutentica } from '../dominio/erros';
import { serializarManifesto, sha256, type ArquivoManifesto, type Manifesto } from '../dominio/manifesto';
import type {
  ArmazenamentoEvidencias,
  ArquivoSelado,
  Assinador,
  CarimboTempo,
  EtapaCustodia,
  RegistradorEventos,
  RegistroCustodia,
  RepositorioEvidencias,
  Relogio,
  Transacao,
  VerificadorOrigem,
} from '../dominio/portas';
import { instrucoesVerificacao } from './instrucoes';

const TIPOS_CONTEUDO: Record<string, string> = {
  IMAGEM: 'image/png',
  VIDEO: 'video/webm',
  METADADOS: 'application/json',
};

/**
 * Selagem das evidências (C13, ADR-0004), na ordem da ADR:
 *  1. SHA-256 de cada arquivo (conferido com o hash calculado pelo worker na captura);
 *  2. manifesto JSON canônico;
 *  3. assinatura do manifesto com a chave da plataforma no KMS;
 *  4. carimbo do tempo RFC 3161 sobre o hash do manifesto (FreeTSA — único desvio acordado);
 *  5. gravação de arquivos, manifesto, assinatura e carimbo no armazenamento WORM;
 *  6. cada passo registrado na cadeia de custódia.
 * Só depois disso publica EvidenciaSelada e o registro pode ir para Concluído.
 */
export class SelarEvidencia {
  constructor(
    private readonly origem: VerificadorOrigem,
    private readonly armazenamento: ArmazenamentoEvidencias,
    private readonly assinador: Assinador,
    private readonly carimbo: CarimboTempo,
    private readonly evidencias: RepositorioEvidencias,
    private readonly custodia: RegistroCustodia,
    private readonly eventos: RegistradorEventos,
    private readonly relogio: Relogio,
  ) {}

  async executar(tx: Transacao, evento: CapturaConcluida): Promise<'selada' | 'ja_selada'> {
    const d = evento.dados;
    if (await this.evidencias.existe(tx, d.registroId)) return 'ja_selada';

    const etapas: EtapaCustodia[] = [];
    const etapa = (nome: string, detalhes: Record<string, unknown>) =>
      etapas.push({ etapa: nome, detalhes, em: this.relogio.agora() });

    // Verificador de Origem
    if (!this.origem.autentico(d)) throw new OrigemNaoAutentica();
    etapa('ORIGEM_VERIFICADA', { workerId: d.workerId, sessaoId: d.sessaoId, eventoId: evento.id });

    // 1) Hash de cada arquivo, conferido com o calculado na captura
    const prefixo = `${d.registroId}/`;
    const arquivos: (Omit<ArquivoSelado, 'versaoWorm'> & { conteudo: Buffer })[] = [];
    for (const a of d.artefatos) {
      const conteudo = await this.armazenamento.lerTemporario(a.chave);
      const hash = sha256(conteudo).toString('hex');
      if (hash !== a.sha256 || conteudo.length !== a.tamanhoBytes) throw new ArquivoDivergente(a.nomeArquivo, a.sha256, hash);
      arquivos.push({
        nome: `arquivos/${a.nomeArquivo}`,
        tipo: a.tipo,
        tamanhoBytes: conteudo.length,
        sha256: hash,
        capturadoEm: a.capturadoEm,
        url: a.url,
        chaveWorm: `${prefixo}arquivos/${a.nomeArquivo}`,
        conteudo,
      });
    }
    etapa('HASHES_CALCULADOS', { arquivos: arquivos.map((a) => ({ nome: a.nome, sha256: a.sha256 })) });

    // 2) Manifesto
    const manifesto: Manifesto = {
      versao: 1,
      algoritmoHash: 'SHA-256',
      registroId: d.registroId,
      usuarioId: d.usuarioId,
      urlInicial: d.urlInicial,
      inicioCaptura: d.inicio,
      fimCaptura: d.fim,
      sessaoId: d.sessaoId,
      workerId: d.workerId,
      arquivos: arquivos.map(({ nome, tipo, tamanhoBytes, sha256, capturadoEm, url }): ArquivoManifesto => ({
        nome, tipo, tamanhoBytes, sha256, capturadoEm, url,
      })),
      metadadosTecnicos: d.metadados,
      geradoEm: this.relogio.agora().toISOString(),
    };
    const bytesManifesto = serializarManifesto(manifesto);
    const digest = sha256(bytesManifesto);
    const hashManifesto = digest.toString('hex');
    etapa('MANIFESTO_GERADO', { hashManifesto });

    // 3) Assinatura no KMS
    const assinatura = await this.assinador.assinar(digest);
    etapa('MANIFESTO_ASSINADO', { chave: assinatura.chaveId, algoritmo: assinatura.algoritmo });

    // 4) Carimbo do tempo sobre o hash do manifesto
    const carimbo = await this.carimbo.carimbar(digest);
    etapa('CARIMBO_OBTIDO', { autoridade: carimbo.autoridade, horario: carimbo.horario.toISOString() });

    // 5) Armazenamento imutável (WORM)
    const chavePublica = await this.assinador.chavePublicaPem();
    const versoes: Record<string, string> = {};
    for (const a of arquivos) {
      versoes[a.chaveWorm] = await this.armazenamento.gravarImutavel(
        a.chaveWorm,
        a.conteudo,
        TIPOS_CONTEUDO[a.tipo] ?? 'application/octet-stream',
      );
    }
    const extras: [string, Buffer, string][] = [
      ['manifesto.json', bytesManifesto, 'application/json'],
      ['manifesto.sig', assinatura.assinatura, 'application/octet-stream'],
      ['manifesto.tsr', carimbo.resposta, 'application/timestamp-reply'],
      ['chave-publica.pem', Buffer.from(chavePublica), 'application/x-pem-file'],
      ['VERIFICACAO.txt', Buffer.from(instrucoesVerificacao(hashManifesto)), 'text/plain; charset=utf-8'],
    ];
    for (const [nome, conteudo, tipo] of extras) {
      versoes[prefixo + nome] = await this.armazenamento.gravarImutavel(prefixo + nome, conteudo, tipo);
    }
    etapa('ARMAZENADO_WORM', { prefixo, objetos: arquivos.length + extras.length });

    // Persistência + custódia + evento, tudo na mesma transação (ADR-0007)
    const agora = this.relogio.agora();
    etapa('SELADA', { hashManifesto });
    await this.evidencias.salvar(tx, {
      registroId: d.registroId,
      usuarioId: d.usuarioId,
      urlInicial: d.urlInicial,
      inicioCaptura: new Date(d.inicio),
      fimCaptura: new Date(d.fim),
      hashManifesto,
      assinatura: assinatura.assinatura.toString('base64'),
      chaveAssinatura: assinatura.chaveId,
      algoritmoAssinatura: assinatura.algoritmo,
      carimboHorario: carimbo.horario,
      carimboTsa: carimbo.autoridade,
      prefixoWorm: prefixo,
      versoesWorm: versoes,
      quantidadeImagens: arquivos.filter((a) => a.tipo === 'IMAGEM').length,
      quantidadeVideos: arquivos.filter((a) => a.tipo === 'VIDEO').length,
      seladaEm: agora,
      arquivos: arquivos.map(({ conteudo: _c, ...a }) => ({ ...a, versaoWorm: versoes[a.chaveWorm] })),
    });
    await this.custodia.registrar(tx, d.registroId, etapas);
    await this.eventos.registrar(
      tx,
      criarEvento(
        'EvidenciaSelada',
        {
          registroId: d.registroId,
          hashManifesto,
          quantidadeImagens: arquivos.filter((a) => a.tipo === 'IMAGEM').length,
          quantidadeVideos: arquivos.filter((a) => a.tipo === 'VIDEO').length,
          seladaEm: agora.toISOString(),
        },
        { correlationId: d.registroId, origem: 'evidencias' },
      ),
    );
    return 'selada';
  }

  /** Falha definitiva (após as retentativas): o Registros estorna os créditos (saga). */
  async registrarFalha(tx: Transacao, registroId: string, motivo: string) {
    await this.custodia.registrar(tx, registroId, [{ etapa: 'SELAGEM_FALHOU', detalhes: { motivo }, em: this.relogio.agora() }]);
    await this.eventos.registrar(
      tx,
      criarEvento('SelagemFalhou', { registroId, motivo }, { correlationId: registroId, origem: 'evidencias' }),
    );
  }
}
