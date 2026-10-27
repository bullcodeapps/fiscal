import type { Certificate } from "../core/certificate";
import { brazilDateTime, escapeXml, leaf } from "../core/xml";
import { signEnveloped } from "../core/xmldsig";
import type { Environment } from "../core/environment";

const NAMESPACE = "http://www.sped.fazenda.gov.br/nfse";
const LAYOUT_VERSION = "1.01";
const CANCELLATION = "101101";

/** 1 Erro na emissão, 2 Serviço não prestado, 9 Outros. */
export type CancellationReason = 1 | 2 | 9;

export interface CancellationInput {
  environment: Environment;
  accessKey: string;
  /** The issuer's CNPJ (the event author). */
  authorCnpj: string;
  reason: CancellationReason;
  /** 15 to 255 characters. */
  description: string;
  verAplic: string;
  at: Date;
}

/** Signed pedRegEvento for event e101101 (Cancelamento de NFS-e). */
export function buildCancellation(
  input: CancellationInput,
  certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">,
): string {
  const description = input.description.trim();
  if (description.length < 15 || description.length > 255) {
    throw new RangeError("A justificativa do cancelamento deve ter entre 15 e 255 caracteres.");
  }
  const xml =
    `<pedRegEvento xmlns="${NAMESPACE}" versao="${LAYOUT_VERSION}">` +
    `<infPedReg Id="PRE${input.accessKey}${CANCELLATION}">` +
    leaf("tpAmb", input.environment === "production" ? 1 : 2) +
    leaf("verAplic", input.verAplic) +
    leaf("dhEvento", brazilDateTime(input.at)) +
    leaf("CNPJAutor", input.authorCnpj) +
    leaf("chNFSe", input.accessKey) +
    `<e${CANCELLATION}>` +
    "<xDesc>Cancelamento de NFS-e</xDesc>" +
    leaf("cMotivo", input.reason) +
    `<xMotivo>${escapeXml(description)}</xMotivo>` +
    `</e${CANCELLATION}>` +
    "</infPedReg></pedRegEvento>";
  return `<?xml version="1.0" encoding="UTF-8"?>${signEnveloped(xml, "infPedReg", certificate)}`;
}
