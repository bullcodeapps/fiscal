import https from "node:https";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Certificate } from "../core/certificate";
import type { Environment } from "../core/environment";

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
 * - `rejected`: Sefin answered and refused the DPS. Nothing was issued;
 *   fix the input and send a new DPS (same Id is fine).
 * - `unavailable`: no definitive answer (timeout, 5xx, network). The DPS
 *   MAY have been authorized: call `findAccessKeyByDpsId` before resending.
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
  accessKey: string;
  nfseXml: string;
  dpsId: string;
  alerts: SefinMessage[];
}

interface RawResponse {
  status: number;
  body: string;
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

/** Maps a raw Sefin answer to a result or a SefinError. */
export function interpretEmission(response: RawResponse): IssuedNfse {
  const json = parseJson(response.body);

  if (response.status >= 200 && response.status < 300 && json) {
    const accessKey = json.chaveAcesso;
    const nfseGzip = json.nfseXmlGZipB64;
    if (typeof accessKey === "string" && typeof nfseGzip === "string") {
      return {
        accessKey,
        nfseXml: gunzipSync(Buffer.from(nfseGzip, "base64")).toString("utf8"),
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
    return gunzipSync(Buffer.from(json.eventoXmlGZipB64, "base64")).toString("utf8");
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
  certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">;
  timeoutMs?: number;
}

export class SefinClient {
  private readonly baseUrl: string;
  private readonly agent: https.Agent;
  private readonly timeoutMs: number;

  constructor(options: SefinClientOptions) {
    this.baseUrl = BASE_URLS[options.environment];
    this.agent = new https.Agent({
      key: options.certificate.privateKeyPem,
      cert: options.certificate.certificatePem,
    });
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
   * XML Sefin signed back. Resending an event that already went through is
   * rejected by Sefin, so an `unavailable` error is safe to retry.
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

  async getNfseXml(accessKey: string): Promise<string> {
    const response = await this.request("GET", `/nfse/${encodeURIComponent(accessKey)}`);
    const json = parseJson(response.body);
    if (response.status === 200 && typeof json?.nfseXmlGZipB64 === "string") {
      return gunzipSync(Buffer.from(json.nfseXmlGZipB64, "base64")).toString("utf8");
    }
    const messages = toMessages(json?.erros);
    throw new SefinError(
      response.status === 404 ? "rejected" : "unavailable",
      messages,
      response.status,
    );
  }

  private request(method: "GET" | "POST", path: string, body?: string): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        `${this.baseUrl}${path}`,
        {
          method,
          agent: this.agent,
          timeout: this.timeoutMs,
          headers: {
            Accept: "application/json",
            ...(body
              ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
              : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
          );
          res.on("error", () => reject(new SefinError("unavailable", [])));
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", () => reject(new SefinError("unavailable", [])));
      if (body) req.write(body);
      req.end();
    });
  }
}
