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

/** An opened A1 e-CNPJ. Holds the private key: keep it in memory only, never log or persist it. */
export interface Certificate {
  /** The holder's CNPJ: 14 digits, or digits and uppercase letters. Use it as `prest.CNPJ` and `authorCnpj`. */
  cnpj: string;
  /** Subject CN, usually "RAZAO SOCIAL:CNPJ". */
  subjectName: string;
  /** Issuing CA CN. */
  issuerName: string;
  serialNumber: string;
  validFrom: Date;
  /** Sefin refuses an expired certificate at the TLS handshake (HTTP 401/403). */
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
      const cnpj = String(inner.value).replace(/[^0-9A-Za-z]/g, "").toUpperCase();
      return /^[0-9A-Z]{12}\d{2}$/.test(cnpj) ? cnpj : null;
    } catch {
      // Malformed otherName: treat the certificate as not an e-CNPJ.
      return null;
    }
  }
  return null;
}

// node-forge instead of Node's TLS `pfx` option because OpenSSL 3 rejects the
// RC2/3DES-encrypted bundles many Brazilian CAs still issue.
// forge parses and derives keys synchronously (~3 ms per 1,000 iterations),
// so an untrusted file must be small and cheap before it reaches forge. Real
// A1 files are a few KB, with 2,000 to ~100,000 iterations per derivation.
const MAX_PFX_BYTES = 64 * 1024;
const MAX_PASSWORD_LENGTH = 256;
const MAX_TOTAL_KDF_ITERATIONS = 300_000n;

/**
 * Sum of the iteration counts readable before decryption (MacData, PBE and
 * PBKDF2 params, each an OCTET STRING salt followed by its count). Counts
 * inside an encrypted layer stay invisible: see SECURITY.md.
 */
function totalIterations(node: forge.asn1.Asn1): bigint {
  if (Array.isArray(node.value)) {
    const children = node.value as forge.asn1.Asn1[];
    return children.reduce((total, child, index) => {
      const previous = children[index - 1];
      const count =
        child.type === forge.asn1.Type.INTEGER && previous?.type === forge.asn1.Type.OCTETSTRING
          ? BigInt(`0x${forge.util.bytesToHex(child.value as string) || "0"}`)
          : 0n;
      return total + count + totalIterations(child);
    }, 0n);
  }
  if (node.type === forge.asn1.Type.OCTETSTRING && typeof node.value === "string" && node.value.length > 2) {
    try {
      return totalIterations(forge.asn1.fromDer(node.value));
    } catch {
      return 0n;
    }
  }
  return 0n;
}

/**
 * Opens an ICP-Brasil A1 e-CNPJ (.pfx / .p12) and reads its CNPJ.
 *
 * Extraction only: the ICP-Brasil chain is not validated, so `cnpj` is not proof that the uploader owns it.
 *
 * @throws {CertificateError} `unreadable` (wrong password, bad file, file over 64 KB, password over 256
 * characters, or over 300,000 total KDF iterations), `missing_key`, `missing_cnpj`.
 * @example
 * const certificate = loadCertificate(readFileSync("cert.pfx"), password);
 * certificate.cnpj; // "11222333000181"
 * @see docs/integration.md section 2
 */
export function loadCertificate(pfx: Buffer, password: string): Certificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    if (pfx.length > MAX_PFX_BYTES || password.length > MAX_PASSWORD_LENGTH) throw new Error("input above size cap");
    const asn1 = forge.asn1.fromDer(pfx.toString("binary"));
    if (totalIterations(asn1) > MAX_TOTAL_KDF_ITERATIONS) throw new Error("iterations above cap");
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
