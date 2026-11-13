import {
  findMunicipality,
  findMunicipalityCode,
  signEnveloped
} from "./chunk-Q3O3QATY.js";

// src/core/certificate.ts
import forge from "node-forge";
var ICP_BRASIL_CNPJ_OID = "2.16.76.1.3.3";
var CertificateError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
  name = "CertificateError";
};
function commonName(attributes) {
  const cn = attributes.find((attribute) => attribute.shortName === "CN");
  return String(cn?.value ?? "");
}
function extractCnpj(certificate) {
  const extension = certificate.getExtension("subjectAltName");
  for (const altName of extension?.altNames ?? []) {
    if (altName.type !== 0 || !Array.isArray(altName.value)) continue;
    const [oidNode, wrapper] = altName.value;
    try {
      if (forge.asn1.derToOid(oidNode.value) !== ICP_BRASIL_CNPJ_OID) {
        continue;
      }
      const inner = wrapper.value[0];
      const cnpj = String(inner.value).replace(/[^0-9A-Za-z]/g, "").toUpperCase();
      return /^[0-9A-Z]{14}$/.test(cnpj) ? cnpj : null;
    } catch {
      return null;
    }
  }
  return null;
}
var MAX_PFX_BYTES = 64 * 1024;
var MAX_PASSWORD_LENGTH = 256;
var MAX_TOTAL_KDF_ITERATIONS = 300000n;
function totalIterations(node) {
  if (Array.isArray(node.value)) {
    const children = node.value;
    return children.reduce((total, child, index) => {
      const previous = children[index - 1];
      const count = child.type === forge.asn1.Type.INTEGER && previous?.type === forge.asn1.Type.OCTETSTRING ? BigInt(`0x${forge.util.bytesToHex(child.value) || "0"}`) : 0n;
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
function loadCertificate(pfx, password) {
  let p12;
  try {
    if (pfx.length > MAX_PFX_BYTES || password.length > MAX_PASSWORD_LENGTH) throw new Error("input above size cap");
    const asn1 = forge.asn1.fromDer(pfx.toString("binary"));
    if (totalIterations(asn1) > MAX_TOTAL_KDF_ITERATIONS) throw new Error("iterations above cap");
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch {
    throw new CertificateError(
      "unreadable",
      "N\xE3o foi poss\xEDvel abrir o certificado. Verifique o arquivo e a senha."
    );
  }
  const keyBags = [
    ...p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [],
    ...p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []
  ];
  const privateKey = keyBags[0]?.key;
  const certificates = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((bag) => bag.cert).filter((cert) => Boolean(cert));
  const certificate = privateKey ? certificates.find(
    (cert) => cert.publicKey.n.equals(privateKey.n)
  ) : void 0;
  if (!privateKey || !certificate) {
    throw new CertificateError(
      "missing_key",
      "O arquivo n\xE3o cont\xE9m a chave privada do certificado. Envie o certificado A1 completo (.pfx)."
    );
  }
  const cnpj = extractCnpj(certificate);
  if (!cnpj) {
    throw new CertificateError(
      "missing_cnpj",
      "O certificado n\xE3o \xE9 um e-CNPJ ICP-Brasil."
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
    certificatePem: forge.pki.certificateToPem(certificate)
  };
}
export {
  CertificateError,
  findMunicipality,
  findMunicipalityCode,
  loadCertificate,
  signEnveloped
};
