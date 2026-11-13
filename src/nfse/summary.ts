import { XMLParser } from "fast-xml-parser";
import { assertWellFormed } from "../core/xml";

export interface NfseSummary {
  accessKey: string;
  /** nNFSe, the number the municipality shows on the note. */
  number: string | null;
  /** CNPJ (may have letters) or CPF of the taker, unmasked; null when the note has none. */
  takerDocument: string | null;
  /** vServ in cents. */
  serviceValueCents: number;
  /** dCompet, YYYY-MM-DD. */
  competenceDate: string | null;
  /** xDescServ. */
  description: string | null;
  /** CNPJ (may have letters) or CPF of the provider (emit), unmasked. */
  providerDocument: string | null;
  /** xNome of the taker. */
  takerName: string | null;
  /** NIF of a foreign taker. */
  takerNif: string | null;
  /** dhEmi of the DPS, as written (with offset). */
  issuedAt: string | null;
  /** vISSQN in cents; 0 when the note has none. */
  issqnCents: number;
  /** regApTribSN = 1: the ISSQN is paid inside the Simples Nacional DAS, not on its own. */
  issqnInSimples: boolean;
}

export interface NfseEventSummary {
  /** chNFSe the event refers to. */
  accessKey: string;
  /** Event code without the "e" (101101 is cancellation). */
  code: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
});

/** What a caller needs to confirm an existing NFS-e is the one it meant to issue. */
export function readNfseSummary(nfseXml: string): NfseSummary {
  assertWellFormed(nfseXml);
  const inf = parser.parse(nfseXml)?.NFSe?.infNFSe;
  if (!inf) throw new Error("Not an NFS-e: infNFSe is missing");
  const infDps = inf?.DPS?.infDPS;
  const toma = infDps?.toma;
  const vServ = infDps?.valores?.vServPrest?.vServ;
  const description = infDps?.serv?.cServ?.xDescServ;
  const text = (value: unknown) => (value === undefined || value === null ? null : String(value));
  return {
    accessKey: String(inf?.["@_Id"] ?? "").replace(/^NFS/, ""),
    number: inf?.nNFSe === undefined ? null : String(inf.nNFSe),
    takerDocument: toma?.CNPJ ?? toma?.CPF ?? null,
    serviceValueCents: Math.round(Number(vServ ?? 0) * 100),
    competenceDate: infDps?.dCompet ?? null,
    description: description === undefined ? null : String(description),
    providerDocument: text(inf?.emit?.CNPJ ?? inf?.emit?.CPF),
    takerName: text(toma?.xNome),
    takerNif: text(toma?.NIF),
    issuedAt: text(infDps?.dhEmi),
    issqnCents: Math.round(Number(inf?.valores?.vISSQN ?? 0) * 100),
    issqnInSimples: String(infDps?.prest?.regTrib?.regApTribSN ?? "") === "1",
  };
}

/** Reads an event XML distributed by the ADN (the registered event wraps the original request). */
export function readNfseEventSummary(eventXml: string): NfseEventSummary {
  assertWellFormed(eventXml);
  const infPedReg = findKey(parser.parse(eventXml), "infPedReg") as Record<string, unknown> | undefined;
  const codeKey = Object.keys(infPedReg ?? {}).find((key) => /^e\d{6}$/.test(key));
  return {
    accessKey: String(infPedReg?.chNFSe ?? ""),
    code: codeKey ? codeKey.slice(1) : null,
  };
}

/**
 * The note, code and sequence of a registered event: `evento/infEvento` with its nSeqEvento and the request
 * inside it. Null for anything else, including malformed XML and the bare request, which proves nothing.
 */
export function registeredEvent(eventXml: string): { accessKey: string; code: string; sequence: number } | null {
  const infEvento = parseOrNull(eventXml)?.evento?.infEvento;
  const infPedReg = infEvento?.pedRegEvento?.infPedReg;
  const sequence = String(infEvento?.nSeqEvento ?? "");
  const codeKey = Object.keys(infPedReg ?? {}).find((key) => /^e\d{6}$/.test(key));
  const accessKey = infPedReg?.chNFSe;
  if (!/^\d+$/.test(sequence) || !codeKey || !isAccessKey(accessKey)) return null;
  return { accessKey, code: codeKey.slice(1), sequence: Number(sequence) };
}

function parseOrNull(xml: string): ReturnType<typeof parser.parse> | null {
  try {
    assertWellFormed(xml);
    return parser.parse(xml);
  } catch {
    return null;
  }
}

function findKey(node: unknown, key: string): unknown {
  if (!node || typeof node !== "object") return undefined;
  const record = node as Record<string, unknown>;
  if (key in record) return record[key];
  for (const child of Object.values(record)) {
    const found = findKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

const DPS_DIGEST = /<(?:\w+:)?Reference URI="#(DPS[0-9A-Z]{42})"[\s\S]*?<(?:\w+:)?DigestValue>([^<]+)</;

/**
 * True when `nfseXml` is the note Sefin issued for exactly this signed DPS: same DPS Id and same
 * signed content. Use it after reconciliation (E0014, timeout) before accepting the note found by
 * DPS Id, because another DPS that reused the number has the same Id but different content.
 */
export function isNfseOfDps(nfseXml: string, signedDpsXml: string): boolean {
  const note = DPS_DIGEST.exec(nfseXml);
  const dps = DPS_DIGEST.exec(signedDpsXml);
  return !!note && !!dps && note[1] === dps[1] && note[2].trim() === dps[2].trim();
}

const ACCESS_KEY = /^[0-9A-Z]{50}$/;

/** A chave de acesso: 50 digits, or digits and uppercase letters with an alphanumeric CNPJ. */
export const isAccessKey = (value: unknown): value is string => typeof value === "string" && ACCESS_KEY.test(value);

/** The access key in the note's own `NFSe/infNFSe/@Id`, or null (also for malformed XML). */
export function nfseAccessKey(nfseXml: string): string | null {
  const id = parseOrNull(nfseXml)?.NFSe?.infNFSe?.["@_Id"];
  const key = typeof id === "string" ? id.replace(/^NFS/, "") : null;
  return isAccessKey(key) && id === `NFS${key}` ? key : null;
}
