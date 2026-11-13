import type https from "node:https";
import type { Certificate } from "../core/certificate";
import type { Environment } from "../core/environment";
import { gunzipBase64, mtlsAgent, request, type RawResponse } from "./http";

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

function toMessages(raw: unknown): AdnMessage[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return (list as Record<string, unknown>[]).map((m) => ({
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
    const batch = Array.isArray(json?.LoteDFe) ? (json.LoteDFe as Record<string, unknown>[]) : [];
    const nsus = batch.map((doc) => Number(doc.NSU));
    let xmls: string[];
    try {
      if (!nsus.every((nsu) => Number.isSafeInteger(nsu) && nsu > 0)) throw new Error("invalid NSU");
      xmls = gunzipBase64(...batch.map((doc) => String(doc.ArquivoXml ?? "")));
    } catch {
      throw new AdnError("unavailable", [], response.status);
    }
    return batch.map((doc, index) => ({
      nsu: nsus[index],
      accessKey: typeof doc.ChaveAcesso === "string" ? doc.ChaveAcesso : null,
      type: String(doc.TipoDocumento ?? ""),
      xml: xmls[index],
    }));
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
