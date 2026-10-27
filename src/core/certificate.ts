import forge from "node-forge";

// ICP-Brasil DOC-ICP-04: the e-CNPJ holder's CNPJ lives in a subjectAltName
// otherName with this OID.
const ICP_BRASIL_CNPJ_OID = "2.16.76.1.3.3";

export type CertificateErrorCode =
  | "unreadable"
  | "missing_key"
  | "missing_cnpj";

/** `message` is Portuguese and safe to show to the certificate owner. */
export class CertificateError extends Error {
  public readonly name = "CertificateError";

  constructor(
    public readonly code: CertificateErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Certificate {
  cnpj: string;
  subjectName: string;
  issuerName: string;
  serialNumber: string;
  validFrom: Date;
  validTo: Date;
  privateKeyPem: string;
  certificatePem: string;
}

function commonName(attributes: forge.pki.CertificateField[]): string {
  const cn = attributes.find((attribute) => attribute.shortName === "CN");
  return String(cn?.value ?? "");
}

function extractCnpj(certificate: forge.pki.Certificate): string | null {
  const extension = certificate.getExtension("subjectAltName") as
    | { altNames?: { type: number; value: unknown }[] }
    | undefined;

  for (const altName of extension?.altNames ?? []) {
    if (altName.type !== 0 || !Array.isArray(altName.value)) continue;
    const [oidNode, wrapper] = altName.value as forge.asn1.Asn1[];
    try {
      if (forge.asn1.derToOid(oidNode.value as string) !== ICP_BRASIL_CNPJ_OID) {
        continue;
      }
      const inner = (wrapper.value as forge.asn1.Asn1[])[0];
      const digits = String(inner.value).replace(/\D/g, "");
      return digits.length === 14 ? digits : null;
    } catch {
      // Malformed otherName: treat the certificate as not an e-CNPJ.
      return null;
    }
  }
  return null;
}

/**
 * Opens an A1 (.pfx / .p12) certificate. node-forge instead of Node's TLS
 * `pfx` option because OpenSSL 3 rejects the RC2/3DES-encrypted bundles many
 * Brazilian CAs still issue.
 */
// node-forge derives keys in synchronous JS (~3 ms per 1,000 iterations) and
// takes the count from the file before checking the password, so an untrusted
// .pfx could freeze the event loop. Real A1 exports use 2,000 to ~100,000.
const MAX_KDF_ITERATIONS = 200_000;

/**
 * PKCS#12 stores every salt as an OCTET STRING followed by its iteration
 * count (MacData, PBE and PBKDF2 params), outside the encrypted parts.
 */
function exceedsIterationCap(node: forge.asn1.Asn1): boolean {
  if (Array.isArray(node.value)) {
    const children = node.value as forge.asn1.Asn1[];
    return children.some((child, index) => {
      const previous = children[index - 1];
      if (
        child.type === forge.asn1.Type.INTEGER &&
        previous?.type === forge.asn1.Type.OCTETSTRING &&
        BigInt(`0x${forge.util.bytesToHex(child.value as string) || "0"}`) > BigInt(MAX_KDF_ITERATIONS)
      ) {
        return true;
      }
      return exceedsIterationCap(child);
    });
  }
  if (node.type === forge.asn1.Type.OCTETSTRING && typeof node.value === "string" && node.value.length > 2) {
    try {
      return exceedsIterationCap(forge.asn1.fromDer(node.value));
    } catch {
      return false;
    }
  }
  return false;
}

export function loadCertificate(pfx: Buffer, password: string): Certificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(pfx.toString("binary"));
    if (exceedsIterationCap(asn1)) throw new Error("iteration count above cap");
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch {
    throw new CertificateError(
      "unreadable",
      "Não foi possível abrir o certificado. Verifique o arquivo e a senha.",
    );
  }

  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[
      forge.pki.oids.keyBag
    ] ?? []),
  ];
  const privateKey = keyBags[0]?.key as forge.pki.rsa.PrivateKey | undefined;
  const certificates = (
    p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ??
    []
  )
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => Boolean(cert));

  const certificate = privateKey
    ? certificates.find((cert) =>
        (cert.publicKey as forge.pki.rsa.PublicKey).n.equals(privateKey.n),
      )
    : undefined;
  if (!privateKey || !certificate) {
    throw new CertificateError(
      "missing_key",
      "O arquivo não contém a chave privada do certificado. Envie o certificado A1 completo (.pfx).",
    );
  }

  const cnpj = extractCnpj(certificate);
  if (!cnpj) {
    throw new CertificateError(
      "missing_cnpj",
      "O certificado não é um e-CNPJ ICP-Brasil.",
    );
  }

  return {
    cnpj,
    subjectName: commonName(certificate.subject.attributes),
    issuerName: commonName(certificate.issuer.attributes),
    serialNumber: certificate.serialNumber,
    validFrom: certificate.validity.notBefore,
    validTo: certificate.validity.notAfter,
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certificatePem: forge.pki.certificateToPem(certificate),
  };
}
