import type https from "node:https";
import { gzipSync } from "node:zlib";
import type { Certificate } from "../core/certificate";
import type { Environment } from "../core/environment";
import { gunzipBase64, mtlsAgent, request, type RawResponse } from "./http";

const BASE_URLS: Record<Environment, string> = {
  production: "https://sefin.nfse.gov.br/SefinNacional",
  restricted: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
};

export interface SefinMessage {
  code: string;
  description: string;
  complement?: string;
}

/**
 * - `rejected`: Sefin answered and refused the DPS. Nothing was issued, except
 *   with code E0014 (this DPS already has a note: reconcile, do not resend);
 *   fix the input and send the corrected DPS with the same `nDPS`.
 * - `unavailable`: no definitive answer (timeout, 5xx, network). The DPS
 *   MAY have been authorized: call `findAccessKeyByDpsId` before resending.
 *
 * Either kind with `httpStatus` 401 or 403: Sefin refused the TLS client
 * certificate (expired, revoked, not an e-CNPJ) and did not process the DPS.
 */
export class SefinError extends Error {
  public readonly name = "SefinError";

  constructor(
    public readonly kind: "rejected" | "unavailable",
    public readonly messages: SefinMessage[],
    public readonly httpStatus?: number,
  ) {
    super(
      messages.length
        ? messages.map((m) => `${m.code}: ${m.description}`).join("; ")
        : `Sefin Nacional indisponível${httpStatus ? ` (HTTP ${httpStatus})` : ""}`,
    );
  }
}

export interface IssuedNfse {
  /** Chave de acesso, 50 characters (letters only with an alphanumeric CNPJ). Persist it first. */
  accessKey: string;
  /** The authorized NFS-e XML signed by Sefin. Store it: the DANFSe is rendered from it. */
  nfseXml: string;
  dpsId: string;
  /** Non-blocking warnings. */
  alerts: SefinMessage[];
}

// Emission answers `erros: [{ Codigo, ... }]`; the event endpoint answers
// `erro` (object or array) with lowercase keys.
type RawMessage = Record<string, unknown>;

function toMessages(raw: unknown): SefinMessage[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return (list as RawMessage[]).map((m) => {
    const complement = m.Complemento ?? m.complemento;
    return {
      code: String(m.Codigo ?? m.codigo ?? ""),
      description: String(m.Descricao ?? m.descricao ?? ""),
      ...(complement ? { complement: String(complement) } : {}),
    };
  });
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** A payload that cannot be decoded is not a definitive answer. */
function decode(gzipB64: string, httpStatus: number): string {
  try {
    return gunzipBase64(gzipB64)[0];
  } catch {
    throw new SefinError("unavailable", [], httpStatus);
  }
}

/** Maps a raw Sefin answer to a result or a SefinError. */
export function interpretEmission(response: RawResponse): IssuedNfse {
  const json = parseJson(response.body);

  if (response.status >= 200 && response.status < 300 && json) {
    const accessKey = json.chaveAcesso;
    const nfseGzip = json.nfseXmlGZipB64;
    if (typeof accessKey === "string" && typeof nfseGzip === "string") {
      return {
        accessKey,
        nfseXml: decode(nfseGzip, response.status),
        dpsId: String(json.idDps ?? json.idDPS ?? ""),
        alerts: toMessages(json.alertas),
      };
    }
  }

  const messages = toMessages(json?.erros ?? json?.erro);
  const definitive =
    response.status >= 400 && response.status < 500 && messages.length > 0;
  throw new SefinError(
    definitive ? "rejected" : "unavailable",
    messages,
    response.status,
  );
}

/** Maps a raw answer of the event endpoint to the event XML or a SefinError. */
export function interpretEvent(response: RawResponse): string {
  const json = parseJson(response.body);
  if (response.status >= 200 && response.status < 300 && typeof json?.eventoXmlGZipB64 === "string") {
    return decode(json.eventoXmlGZipB64, response.status);
  }
  const messages = toMessages(json?.erro ?? json?.erros);
  throw new SefinError(
    response.status >= 400 && response.status < 500 && messages.length > 0 ? "rejected" : "unavailable",
    messages,
    response.status,
  );
}

export interface SefinClientOptions {
  environment: Environment;
  /** The provider's A1, used for mTLS. */
  certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">;
  /** Idle time per request (no data received), not a total deadline. Default 30000. Throws `SefinError` `unavailable`. */
  timeoutMs?: number;
}

/**
 * Sefin Nacional over mTLS: emission, events, reconciliation and NFS-e lookup.
 * Every method throws `SefinError`; see its `kind` for what to do next.
 * @see docs/integration.md sections 5 to 7
 */
export class SefinClient {
  private readonly baseUrl: string;
  private readonly agent: https.Agent;
  private readonly timeoutMs: number;

  constructor(options: SefinClientOptions) {
    this.baseUrl = BASE_URLS[options.environment];
    this.agent = mtlsAgent(options.certificate);
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Sends a signed DPS. Authorization is synchronous. */
  async emit(signedDpsXml: string): Promise<IssuedNfse> {
    const body = JSON.stringify({
      dpsXmlGZipB64: gzipSync(signedDpsXml).toString("base64"),
    });
    const response = await this.request("POST", "/nfse", body);
    return interpretEmission(response);
  }

  /**
   * Registers a signed event (e.g. `buildCancellation`). Returns the event
   * XML Sefin signed back. After an `unavailable` error the event may have gone
   * through: a retry is safe, but its rejection does not prove the event failed
   * (see docs/integration.md, cancellation).
   */
  async registerEvent(accessKey: string, signedEventXml: string): Promise<string> {
    const body = JSON.stringify({
      pedidoRegistroEventoXmlGZipB64: gzipSync(signedEventXml).toString("base64"),
    });
    const response = await this.request("POST", `/nfse/${encodeURIComponent(accessKey)}/eventos`, body);
    return interpretEvent(response);
  }

  /** Reconciliation after an `unavailable` error. Null when Sefin never authorized it. */
  async findAccessKeyByDpsId(dpsId: string): Promise<string | null> {
    const response = await this.request("GET", `/dps/${encodeURIComponent(dpsId)}`);
    if (response.status === 404) return null;
    const json = parseJson(response.body);
    if (response.status === 200 && typeof json?.chaveAcesso === "string") {
      return json.chaveAcesso;
    }
    throw new SefinError("unavailable", toMessages(json?.erros), response.status);
  }

  /** The authorized NFS-e XML. `rejected` (HTTP 404) when the key does not exist in this environment. */
  async getNfseXml(accessKey: string): Promise<string> {
    const response = await this.request("GET", `/nfse/${encodeURIComponent(accessKey)}`);
    const json = parseJson(response.body);
    if (response.status === 200 && typeof json?.nfseXmlGZipB64 === "string") {
      return decode(json.nfseXmlGZipB64, response.status);
    }
    const messages = toMessages(json?.erros);
    throw new SefinError(
      response.status === 404 ? "rejected" : "unavailable",
      messages,
      response.status,
    );
  }

  private async request(method: "GET" | "POST", path: string, body?: string): Promise<RawResponse> {
    try {
      return await request(this.agent, `${this.baseUrl}${path}`, method, this.timeoutMs, body);
    } catch {
      throw new SefinError("unavailable", []);
    }
  }
}
