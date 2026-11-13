import type { Certificate } from "../core/certificate";
import { signEnveloped } from "../core/xmldsig";

/**
 * Signs a DPS from `buildDps` with the certificate (XMLDSig, RSA-SHA256). Persist the result before
 * calling `SefinClient.emit`: after an `unavailable` error the same signed XML is resent.
 */
export function signDps(
  dpsXml: string,
  certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${signEnveloped(dpsXml, "infDPS", certificate)}`;
}
