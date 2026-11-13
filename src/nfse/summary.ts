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
  /** Id of the DPS the note came from ("DPS" + 42 characters): matches `buildDps(...).id`. */
  dpsId: string | null;
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
    dpsId: text(infDps?.["@_Id"]),
  };
}

/**
 * Reads a registered event (`evento/infEvento/pedRegEvento/infPedReg`), as the ADN distributes it and
 * `registerEvent` / `findEvent` return it. `code` is null for any other well-formed document, including a bare
 * request, which proves nothing.
 */
export function readNfseEventSummary(eventXml: string): NfseEventSummary {
  assertWellFormed(eventXml);
  const infPedReg = parser.parse(eventXml)?.evento?.infEvento?.pedRegEvento?.infPedReg;
  return { accessKey: String(infPedReg?.chNFSe ?? ""), code: eventCode(infPedReg) };
}

/** The note and event code of a signed request (`pedRegEvento`), as `buildCancellation` returns it, or null. */
export function readEventRequest(requestXml: string): { accessKey: string; code: string } | null {
  const infPedReg = parseOrNull(requestXml)?.pedRegEvento?.infPedReg;
  const code = eventCode(infPedReg);
  return code ? { accessKey: String(infPedReg?.chNFSe ?? ""), code } : null;
}

/** The code of the request's single event group (e101101 is 101101); null for none or more than one. */
function eventCode(infPedReg: unknown): string | null {
  const node = (infPedReg && typeof infPedReg === "object" ? infPedReg : {}) as Record<string, unknown>;
  const keys = Object.keys(node).filter((k) => /^e\d{6}$/.test(k));
  // The parser folds a repeated group into one key holding an array.
  return keys.length === 1 && !Array.isArray(node[keys[0]]) ? keys[0].slice(1) : null;
}

/**
 * The note, code and sequence of a registered event: `evento/infEvento` with its nSeqEvento and the request
 * inside it. Null for anything else, including malformed XML and the bare request, which proves nothing.
 */
export function registeredEvent(eventXml: string): { accessKey: string; code: string; sequence: number } | null {
  const infEvento = parseOrNull(eventXml)?.evento?.infEvento;
  const infPedReg = infEvento?.pedRegEvento?.infPedReg;
  const sequence = String(infEvento?.nSeqEvento ?? "");
  const code = eventCode(infPedReg);
  const accessKey = infPedReg?.chNFSe;
  if (!/^\d+$/.test(sequence) || !code || !isAccessKey(accessKey)) return null;
  return { accessKey, code, sequence: Number(sequence) };
}

function parseOrNull(xml: string): ReturnType<typeof parser.parse> | null {
  try {
    assertWellFormed(xml);
    return parser.parse(xml);
  } catch {
    return null;
  }
}


/**
 * True when `nfseXml` is the note Sefin issued for exactly this signed DPS: same DPS Id and same
 * signed content. Use it after reconciliation (E0014, timeout) before accepting the note found by
 * DPS Id, because another DPS that reused the number has the same Id but different content.
 */
export function isNfseOfDps(nfseXml: string, signedDpsXml: string): boolean {
  const note = dpsDigest(parseOrNull(nfseXml)?.NFSe?.infNFSe?.DPS);
  const dps = dpsDigest(parseOrNull(signedDpsXml)?.DPS);
  return !!note && !!dps && note.id === dps.id && note.digest === dps.digest;
}

/** The DPS Id and the digest of the DPS's own signature, which must reference that Id. */
function dpsDigest(dps: Record<string, any> | undefined): { id: string; digest: string } | null {
  const id = dps?.infDPS?.["@_Id"];
  const reference = dps?.Signature?.SignedInfo?.Reference;
  const digest = reference?.DigestValue;
  if (typeof id !== "string" || reference?.["@_URI"] !== `#${id}` || typeof digest !== "string") return null;
  return { id, digest: digest.trim() };
}

// cLocEmi, ambGer and tpInsc (9 digits), the CNPJ or CPF (14, letters only in the first 12 of a CNPJ), then nNFSe,
// AAMM, a random code and the check digit (27 digits).
export const ACCESS_KEY = /^\d{9}[0-9A-Z]{12}\d{29}$/;

/** A chave de acesso: 50 digits, with uppercase letters only in the CNPJ part of an alphanumeric CNPJ. */
export const isAccessKey = (value: unknown): value is string => typeof value === "string" && ACCESS_KEY.test(value);

/** The access key in the note's own `NFSe/infNFSe/@Id`, or null (also for malformed XML). */
export function nfseAccessKey(nfseXml: string): string | null {
  const id = parseOrNull(nfseXml)?.NFSe?.infNFSe?.["@_Id"];
  const key = typeof id === "string" ? id.replace(/^NFS/, "") : null;
  return isAccessKey(key) && id === `NFS${key}` ? key : null;
}
