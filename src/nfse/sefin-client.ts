import type https from "node:https";
import { gzipSync } from "node:zlib";
import type { Certificate } from "../core/certificate";
import type { Environment } from "../core/environment";
import { assertWellFormed } from "../core/xml";
import { gunzipBase64, mtlsAgent, request, type RawResponse } from "./http";
import { isAccessKey, nfseAccessKey, registeredEvent, requestEventCode } from "./summary";

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

const isRecord = (value: unknown): value is RawMessage => typeof value === "object" && value !== null;

function toMessages(raw: unknown): SefinMessage[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(isRecord).map((m) => {
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

/** A payload that cannot be decoded into well-formed XML is not a definitive answer. */
function decode(gzipB64: string, httpStatus: number): string {
  try {
    const xml = gunzipBase64(gzipB64)[0];
    assertWellFormed(xml);
    return xml;
  } catch {
    throw new SefinError("unavailable", [], httpStatus);
  }
}

/** The note and event an event request or lookup is about. */
export interface EventRef {
  accessKey: string;
  /** Event code without the "e", e.g. "101101" for a cancellation. */
  type: string;
  /** nSeqEvento, when a specific one was asked for. */
  sequence?: number;
}

/** A note Sefin returns must carry the key it was asked for or announced. */
function decodeNote(gzipB64: string, httpStatus: number, accessKey: string): string {
  const xml = decode(gzipB64, httpStatus);
  if (nfseAccessKey(xml) !== accessKey) throw new SefinError("unavailable", [], httpStatus);
  return xml;
}

/** An event Sefin returns must be the one asked for, or it proves nothing. */
function decodeEvent(gzipB64: string, httpStatus: number, expected: EventRef): string {
  const xml = decode(gzipB64, httpStatus);
  const event = registeredEvent(xml);
  if (
    event?.accessKey !== expected.accessKey ||
    event.code !== expected.type ||
    (expected.sequence !== undefined && event.sequence !== expected.sequence)
  ) {
    throw new SefinError("unavailable", [], httpStatus);
  }
  return xml;
}

/** Maps a raw Sefin answer to a result or a SefinError. */
export function interpretEmission(response: RawResponse): IssuedNfse {
  const json = parseJson(response.body);

  if (response.status >= 200 && response.status < 300 && json) {
    const accessKey = json.chaveAcesso;
    const nfseGzip = json.nfseXmlGZipB64;
    if (isAccessKey(accessKey) && typeof nfseGzip === "string") {
      return {
        accessKey,
        nfseXml: decodeNote(nfseGzip, response.status, accessKey),
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
export function interpretEvent(response: RawResponse, expected: EventRef): string {
  const json = parseJson(response.body);
  if (response.status >= 200 && response.status < 300 && typeof json?.eventoXmlGZipB64 === "string") {
    return decodeEvent(json.eventoXmlGZipB64, response.status, expected);
  }
  const messages = toMessages(json?.erro ?? json?.erros);
  throw new SefinError(
    response.status >= 400 && response.status < 500 && messages.length > 0 ? "rejected" : "unavailable",
    messages,
    response.status,
  );
}

/** Maps a raw answer of the event lookup to the event XML, null when there is no such event, or a SefinError. */
export function interpretEventLookup(response: RawResponse, expected: EventRef): string | null {
  const json = parseJson(response.body);
  // Only Sefin's error envelope (ResponseErro) means "no event"; a gateway's 404 proves nothing.
  if (response.status === 404 && isRecord(json?.erro) && !Array.isArray(json.erro)) return null;
  if (response.status === 200 && typeof json?.eventoXmlGZipB64 === "string") {
    return decodeEvent(json.eventoXmlGZipB64, response.status, expected);
  }
  const messages = toMessages(json?.erro ?? json?.erros);
  throw new SefinError(
    response.status >= 400 && response.status < 500 && messages.length > 0 ? "rejected" : "unavailable",
    messages,
    response.status,
  );
}

/** Maps a raw answer of `GET /dps/{id}` to the access key, null when Sefin has no note for it, or a SefinError. */
export function interpretDpsLookup(response: RawResponse): string | null {
  if (response.status === 404) return null;
  const json = parseJson(response.body);
  if (response.status === 200 && isAccessKey(json?.chaveAcesso)) return json.chaveAcesso;
  throw new SefinError("unavailable", toMessages(json?.erros ?? json?.erro), response.status);
}

/** Maps a raw answer of `GET /nfse/{chave}` to the note, which must carry that key, or a SefinError. */
export function interpretNfseLookup(response: RawResponse, accessKey: string): string {
  const json = parseJson(response.body);
  if (response.status === 200 && typeof json?.nfseXmlGZipB64 === "string") {
    return decodeNote(json.nfseXmlGZipB64, response.status, accessKey);
  }
  const messages = toMessages(json?.erros ?? json?.erro);
  throw new SefinError(response.status === 404 ? "rejected" : "unavailable", messages, response.status);
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
 * Network and Sefin failures throw `SefinError`; see its `kind` for what to do next. `registerEvent`
 * throws `Error` when given anything but a `pedRegEvento`.
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
    const type = requestEventCode(signedEventXml);
    if (!type) throw new Error("registerEvent: signedEventXml is not a pedRegEvento (use buildCancellation)");
    const body = JSON.stringify({
      pedidoRegistroEventoXmlGZipB64: gzipSync(signedEventXml).toString("base64"),
    });
    const response = await this.request("POST", `/nfse/${encodeURIComponent(accessKey)}/eventos`, body);
    return interpretEvent(response, { accessKey, type });
  }

  /**
   * The registered event of this type and sequence (e.g. "101101", 1 for a cancellation), or null when
   * the note has none. Use it before treating a cancellation as failed or resending one whose outcome
   * is unknown.
   */
  async findEvent(accessKey: string, eventType: string, sequence = 1): Promise<string | null> {
    const path = `/nfse/${encodeURIComponent(accessKey)}/eventos/${encodeURIComponent(eventType)}/${sequence}`;
    return interpretEventLookup(await this.request("GET", path), { accessKey, type: eventType, sequence });
  }

  /** Reconciliation after an `unavailable` error. Null when Sefin never authorized it. */
  async findAccessKeyByDpsId(dpsId: string): Promise<string | null> {
    return interpretDpsLookup(await this.request("GET", `/dps/${encodeURIComponent(dpsId)}`));
  }

  /**
   * The authorized NFS-e XML. `rejected` (HTTP 404) when Sefin does not know the key yet: for a key you just
   * emitted or reconciled, that is propagation, so retry later.
   */
  async getNfseXml(accessKey: string): Promise<string> {
    return interpretNfseLookup(await this.request("GET", `/nfse/${encodeURIComponent(accessKey)}`), accessKey);
  }

  private async request(method: "GET" | "POST", path: string, body?: string): Promise<RawResponse> {
    try {
      return await request(this.agent, `${this.baseUrl}${path}`, method, this.timeoutMs, body);
    } catch {
      throw new SefinError("unavailable", []);
    }
  }
}
