import type { Certificate } from "../core/certificate";
import { signEnveloped } from "../core/xmldsig";

export function signDps(
  dpsXml: string,
  certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${signEnveloped(dpsXml, "infDPS", certificate)}`;
}
