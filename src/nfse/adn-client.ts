import type https from "node:https";
import type { Certificate } from "../core/certificate";
import type { Environment } from "../core/environment";
import { gunzipBase64, mtlsAgent, request, type RawResponse } from "./http";
import { isAccessKey, nfseAccessKey, registeredEvent } from "./summary";

const BASE_URLS: Record<Environment, string> = {
  production: "https://adn.nfse.gov.br/contribuintes",
  restricted: "https://adn.producaorestrita.nfse.gov.br/contribuintes",
};

export interface AdnMessage {
  code: string;
  description: string;
}

/**
 * - `rejected`: the ADN refused the query (e.g. certificate not allowed).
 * - `rate_limited`: HTTP 429; wait before the next call.
 * - `unavailable`: no definitive answer (timeout, 5xx, network, unknown body).
 */
export class AdnError extends Error {
  public readonly name = "AdnError";

  constructor(
    public readonly kind: "rejected" | "rate_limited" | "unavailable",
    public readonly messages: AdnMessage[],
    public readonly httpStatus?: number,
  ) {
    super(
      messages.length
        ? messages.map((m) => `${m.code}: ${m.description}`).join("; ")
        : `${kind === "rejected" ? "ADN recusou a consulta" : "ADN indisponível"}${httpStatus ? ` (HTTP ${httpStatus})` : ""}`,
    );
  }
}

export interface AdnDocument {
  nsu: number;
  accessKey: string | null;
  /** "NFSE" for a note; other values (events) carry their own XML. */
  type: string;
  xml: string;
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function toMessages(raw: unknown): AdnMessage[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(isRecord).map((m) => ({
    code: String(m.Codigo ?? m.codigo ?? ""),
    description: String(m.Descricao ?? m.descricao ?? ""),
  }));
}

/** Maps a raw answer of `GET /DFe/{NSU}` to its documents or an AdnError. */
export function interpretDistribution(response: RawResponse): AdnDocument[] {
  if (response.status === 429) throw new AdnError("rate_limited", [], 429);
  const json = parseJson(response.body);
  const status = json?.StatusProcessamento;

  // An empty queue answers 404 with this status.
  if (status === "NENHUM_DOCUMENTO_LOCALIZADO") return [];
  if (status === "DOCUMENTOS_LOCALIZADOS" && response.status >= 200 && response.status < 300) {
    if (!Array.isArray(json?.LoteDFe)) throw new AdnError("unavailable", [], response.status);
    const batch: unknown[] = json.LoteDFe;
    // A page that does not match the documented shape is not an answer: never let the cursor skip it.
    const wellShaped = (doc: unknown): doc is Record<string, unknown> =>
      isRecord(doc) &&
      (typeof doc.NSU === "number" || (typeof doc.NSU === "string" && /^[1-9][0-9]*$/.test(doc.NSU))) &&
      Number.isSafeInteger(Number(doc.NSU)) &&
      Number(doc.NSU) > 0 &&
      typeof doc.TipoDocumento === "string" &&
      doc.TipoDocumento !== "";
    // A crash between two out-of-order documents would move the cursor past the lower one.
    const increasing = (doc: Record<string, unknown>, index: number, docs: Record<string, unknown>[]) =>
      index === 0 || Number(doc.NSU) > Number(docs[index - 1].NSU);
    if (!batch.every(wellShaped) || !batch.every(increasing)) throw new AdnError("unavailable", [], response.status);
    let xmls: string[];
    try {
      xmls = gunzipBase64(...batch.map((doc) => String(doc.ArquivoXml ?? "")));
    } catch {
      throw new AdnError("unavailable", [], response.status);
    }
    return batch.map((doc, index) => {
      if (doc.ChaveAcesso != null && !isAccessKey(doc.ChaveAcesso)) throw new AdnError("unavailable", [], response.status);
      const envelopeKey = isAccessKey(doc.ChaveAcesso) ? doc.ChaveAcesso : null;
      // The key decides which stored note an import updates, so it comes from the XML itself.
      let xmlKey: string | null = null;
      if (doc.TipoDocumento === "NFSE") xmlKey = nfseAccessKey(xmls[index]);
      if (doc.TipoDocumento === "EVENTO") xmlKey = registeredEvent(xmls[index])?.accessKey ?? null;
      const keyed = doc.TipoDocumento === "NFSE" || doc.TipoDocumento === "EVENTO";
      if (keyed && (!xmlKey || (envelopeKey && envelopeKey !== xmlKey))) {
        throw new AdnError("unavailable", [], response.status);
      }
      return { nsu: Number(doc.NSU), accessKey: xmlKey ?? envelopeKey, type: doc.TipoDocumento as string, xml: xmls[index] };
    });
  }
  const messages = toMessages(json?.Erros);
  if (status === "REJEICAO") throw new AdnError("rejected", messages, response.status);
  throw new AdnError("unavailable", messages, response.status);
}

export interface AdnClientOptions {
  environment: Environment;
  /** CNPJ whose documents are queried (punctuation is ignored, letters kept); the certificate must belong to its root. */
  cnpj: string;
  certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">;
  timeoutMs?: number;
}

/** Distribution of the documents where the certificate's CNPJ is provider, taker or intermediary. */
export class AdnClient {
  private readonly baseUrl: string;
  private readonly cnpj: string;
  private readonly agent: https.Agent;
  private readonly timeoutMs: number;

  constructor(options: AdnClientOptions) {
    this.baseUrl = BASE_URLS[options.environment];
    this.cnpj = options.cnpj.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    this.agent = mtlsAgent(options.certificate);
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /**
   * The next page (up to 50) of documents with an NSU above `lastNsu`, in NSU order. Start with 0 and
   * call again with the highest NSU received until a call returns nothing.
   */
  async fetchDocuments(lastNsu: number): Promise<AdnDocument[]> {
    let response: RawResponse;
    try {
      // Since 2026-11-03 the ADN refuses a query without cnpjConsulta (HTTP 400, REJEICAO with no Erros).
      const query = new URLSearchParams({ cnpjConsulta: this.cnpj, lote: "true" });
      response = await request(this.agent, `${this.baseUrl}/DFe/${lastNsu}?${query}`, "GET", this.timeoutMs);
    } catch {
      throw new AdnError("unavailable", []);
    }
    // Sources disagree on whether the ADN includes `lastNsu` itself in the page.
    return interpretDistribution(response).filter((doc) => doc.nsu > lastNsu);
  }
}
