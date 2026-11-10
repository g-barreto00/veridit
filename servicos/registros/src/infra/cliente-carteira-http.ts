import type { TipoRegistro } from '@veridit/contratos';
import { ErroIndisponivel } from '../dominio/erros';
import { ReservaEmEstadoInvalido, SaldoInsuficiente, type CarteiraCreditos } from '../dominio/portas';

/** Resposta definitiva do serviço (4xx): não adianta repetir. */
class RespostaDefinitiva extends Error {
  constructor(
    readonly status: number,
    readonly corpo: Record<string, unknown>,
  ) {
    super(String(corpo?.mensagem ?? status));
  }
}

/**
 * Cliente da Carteira (C11): chamada síncrona à rota /interno do serviço de Créditos, com
 * timeout e retentativa com backoff (ADR-0008). As operações são idempotentes pela chave, então
 * repetir é seguro.
 */
export class ClienteCarteiraHttp implements CarteiraCreditos {
  constructor(
    private readonly urlBase: string,
    private readonly timeoutMs = 3000,
    private readonly tentativas = 3,
  ) {}

  async reservar(usuarioId: string, chave: string, tipo: TipoRegistro) {
    try {
      const r = await this.post('/interno/reservas', { usuarioId, chave, tipoRegistro: tipo });
      return { creditos: Number(r.creditos) };
    } catch (e) {
      if (e instanceof RespostaDefinitiva && e.status === 402) {
        throw new SaldoInsuficiente(e.corpo.necessario as number, e.corpo.disponivel as number);
      }
      throw this.traduzir(e);
    }
  }

  async consumir(chave: string) {
    await this.post(`/interno/reservas/${encodeURIComponent(chave)}/consumo`, {}).catch((e) => {
      throw this.traduzir(e);
    });
  }

  async estornar(chave: string, motivo: string) {
    await this.post(`/interno/reservas/${encodeURIComponent(chave)}/estorno`, { motivo }).catch((e) => {
      throw this.traduzir(e);
    });
  }

  private traduzir(e: unknown): Error {
    if (e instanceof RespostaDefinitiva && e.status === 409) return new ReservaEmEstadoInvalido(e.message);
    if (e instanceof RespostaDefinitiva) return new Error(`Carteira recusou a operação: ${e.status} ${e.message}`);
    return new ErroIndisponivel('Carteira de créditos indisponível');
  }

  private async post(caminho: string, corpo: unknown): Promise<Record<string, unknown>> {
    let ultimoErro: unknown;
    for (let tentativa = 1; tentativa <= this.tentativas; tentativa++) {
      try {
        const resposta = await fetch(`${this.urlBase}${caminho}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const json = (await resposta.json().catch(() => ({}))) as Record<string, unknown>;
        if (resposta.ok) return json;
        if (resposta.status < 500) throw new RespostaDefinitiva(resposta.status, json);
        ultimoErro = new Error(`HTTP ${resposta.status}`);
      } catch (e) {
        if (e instanceof RespostaDefinitiva) throw e;
        ultimoErro = e;
      }
      await new Promise((r) => setTimeout(r, 200 * 2 ** (tentativa - 1)));
    }
    throw ultimoErro;
  }
}
