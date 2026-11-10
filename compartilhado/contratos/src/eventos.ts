import { Envelope } from './envelope';

/** Modo da sessão de captura (ADR-0003). A gravação de vídeo (REQ09) usa o mesmo modo SESSAO. */
export type TipoArtefato = 'IMAGEM' | 'VIDEO' | 'METADADOS';

export interface MetadadosTecnicos {
  urlFinal: string;
  ipDestino?: string;
  dns?: { hostname: string; enderecos: string[] };
  cabecalhosHttp?: Record<string, string>;
  certificadoTls?: {
    emissor?: string;
    sujeito?: string;
    validoDe?: string;
    validoAte?: string;
    protocolo?: string;
  };
  /** Horário obtido de servidor NTP no momento da captura. */
  horarioNtp?: string;
}

export interface ArtefatoCapturado {
  /** Chave do objeto no bucket captura-temporaria. */
  chave: string;
  nomeArquivo: string;
  tipo: TipoArtefato;
  tamanhoBytes: number;
  capturadoEm: string;
  /** URL da página no momento da captura (REQ14: "site da imagem"). */
  url: string;
}

// ---- Registros → Captura -------------------------------------------------

export type CapturaSolicitada = Envelope<
  'CapturaSolicitada',
  {
    registroId: string;
    usuarioId: string;
    urlInicial: string;
    duracaoMaximaSegundos: number;
  }
>;

// ---- Captura → Registros / Evidências -------------------------------------

export type SessaoIniciada = Envelope<
  'SessaoIniciada',
  {
    registroId: string;
    sessaoId: string;
    workerId: string;
    /** Endereço interno do worker para o gateway encaminhar o WebSocket. */
    enderecoWorker: string;
    iniciadaEm: string;
  }
>;

export type CapturaConcluida = Envelope<
  'CapturaConcluida',
  {
    registroId: string;
    usuarioId: string;
    sessaoId: string;
    workerId: string;
    urlInicial: string;
    inicio: string;
    fim: string;
    artefatos: ArtefatoCapturado[];
    metadados: MetadadosTecnicos[];
  }
>;

export type CapturaFalhou = Envelope<
  'CapturaFalhou',
  {
    registroId: string;
    sessaoId?: string;
    motivo: string;
  }
>;

// ---- Evidências → Registros ----------------------------------------------

export type EvidenciaSelada = Envelope<
  'EvidenciaSelada',
  {
    registroId: string;
    hashManifesto: string;
    quantidadeImagens: number;
    quantidadeVideos: number;
    seladaEm: string;
  }
>;

export type SelagemFalhou = Envelope<
  'SelagemFalhou',
  {
    registroId: string;
    motivo: string;
  }
>;

// ---- Registros → Notificações (sprint 2: REQ10 / REQ11-B) ---------------------

export type RegistroConcluido = Envelope<
  'RegistroConcluido',
  {
    registroId: string;
    usuarioId: string;
    titulo: string;
    concluidoEm: string;
  }
>;

// ---- Identidade → Notificações --------------------------------------------

export type UsuarioCadastrado = Envelope<
  'UsuarioCadastrado',
  {
    usuarioId: string;
    nome: string;
    email: string;
    perfil: 'ADVOGADO' | 'COMUM';
    /** Token de verificação em texto claro; só trafega na fila interna até o e-mail (ADR-0005). */
    tokenVerificacao: string;
  }
>;

// ---- Pagamentos (sprint 2: REQ05–REQ07) ---------------------------------------

export type PagamentoConfirmado = Envelope<
  'PagamentoConfirmado',
  {
    pedidoId: string;
    usuarioId: string;
    creditos: number;
    valorCentavos: number;
    confirmadoEm: string;
  }
>;

export type EventoVeridit =
  | CapturaSolicitada
  | SessaoIniciada
  | CapturaConcluida
  | CapturaFalhou
  | EvidenciaSelada
  | SelagemFalhou
  | RegistroConcluido
  | UsuarioCadastrado
  | PagamentoConfirmado;

export type TipoEvento = EventoVeridit['tipo'];
