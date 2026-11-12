import { XMLParser } from "fast-xml-parser";

export interface NfseSummary {
  accessKey: string;
  /** nNFSe, the number the municipality shows on the note. */
  number: string | null;
  /** CNPJ or CPF digits of the taker; null when the note has none. */
  takerDocument: string | null;
  /** vServ in cents. */
  serviceValueCents: number;
  /** dCompet, YYYY-MM-DD. */
  competenceDate: string | null;
  /** xDescServ. */
  description: string | null;
  /** CNPJ or CPF digits of the provider (emit). */
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
  const inf = parser.parse(nfseXml)?.NFSe?.infNFSe;
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
  const infPedReg = findKey(parser.parse(eventXml), "infPedReg") as Record<string, unknown> | undefined;
  const codeKey = Object.keys(infPedReg ?? {}).find((key) => /^e\d{6}$/.test(key));
  return {
    accessKey: String(infPedReg?.chNFSe ?? ""),
    code: codeKey ? codeKey.slice(1) : null,
  };
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
