import type { Page, Response } from 'playwright-core';
import type { MetadadosTecnicos } from '@veridit/contratos';
import type { RegistroConexoes, RelogioNtp, ResolvedorDns } from '../portas';

/** Cabeçalhos HTTP relevantes para a prova; o resto é descartado para não poluir o relatório. */
const CABECALHOS_GUARDADOS = [
  'server', 'date', 'last-modified', 'content-type', 'content-length', 'etag',
  'cache-control', 'x-powered-by', 'via', 'strict-transport-security',
];

/**
 * Coletor de Metadados (C12): URL final, IP do servidor, DNS, cabeçalhos HTTP, certificado TLS
 * e horário NTP no momento de cada captura (ADR-0003).
 */
export class ColetorMetadados {
  private ultimaResposta?: Response;

  constructor(
    private readonly dns: ResolvedorDns,
    private readonly ntp: RelogioNtp,
    /** O navegador sai pelo proxy; o IP real do destino vem do registro do proxy. */
    private readonly registro: RegistroConexoes,
    private readonly ipNavegador: string,
  ) {}

  /** Acompanha a resposta do documento principal a cada navegação. */
  observar(pagina: Page) {
    pagina.on('response', (r) => {
      if (r.request().isNavigationRequest() && r.frame() === pagina.mainFrame()) this.ultimaResposta = r;
    });
  }

  async coletar(pagina: Page): Promise<MetadadosTecnicos & { horarioSistema: string; fonteHorario: string; tituloPagina: string }> {
    const urlFinal = pagina.url();
    const hostname = safeHostname(urlFinal);
    const resposta = this.ultimaResposta;

    const [ntp, enderecos, conexoes, tls, cabecalhos, titulo] = await Promise.all([
      this.ntp.agora(),
      hostname ? this.dns.resolver(hostname) : Promise.resolve([]),
      this.registro.conexoes(this.ipNavegador).catch(() => []),
      resposta?.securityDetails().catch(() => null),
      resposta?.allHeaders().catch(() => ({}) as Record<string, string>),
      pagina.title().catch(() => ''),
    ]);

    return {
      urlFinal,
      tituloPagina: titulo,
      ipDestino: conexoes.filter((c) => c.host === hostname).at(-1)?.ip,
      dns: hostname ? { hostname, enderecos } : undefined,
      cabecalhosHttp: Object.fromEntries(
        Object.entries(cabecalhos ?? {}).filter(([k]) => CABECALHOS_GUARDADOS.includes(k.toLowerCase())),
      ),
      certificadoTls: tls
        ? {
            emissor: tls.issuer,
            sujeito: tls.subjectName,
            protocolo: tls.protocol,
            validoDe: tls.validFrom ? new Date(tls.validFrom * 1000).toISOString() : undefined,
            validoAte: tls.validTo ? new Date(tls.validTo * 1000).toISOString() : undefined,
          }
        : undefined,
      horarioNtp: ntp?.horario.toISOString(),
      horarioSistema: new Date().toISOString(),
      fonteHorario: ntp?.fonte ?? 'relogio-do-sistema',
    };
  }
}

function safeHostname(url: string) {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? u.hostname : undefined;
  } catch {
    return undefined;
  }
}
