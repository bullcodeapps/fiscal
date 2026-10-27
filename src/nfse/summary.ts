import { XMLParser } from "fast-xml-parser";

export interface NfseSummary {
  accessKey: string;
  /** CNPJ or CPF digits of the taker; null when the note has none. */
  takerDocument: string | null;
  /** vServ in cents. */
  serviceValueCents: number;
  /** dCompet, YYYY-MM-DD. */
  competenceDate: string | null;
  /** xDescServ. */
  description: string | null;
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
  return {
    accessKey: String(inf?.["@_Id"] ?? "").replace(/^NFS/, ""),
    takerDocument: toma?.CNPJ ?? toma?.CPF ?? null,
    serviceValueCents: Math.round(Number(vServ ?? 0) * 100),
    competenceDate: infDps?.dCompet ?? null,
    description: description === undefined ? null : String(description),
  };
}
