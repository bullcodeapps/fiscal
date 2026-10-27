import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";

interface MakePfxOptions {
  password: string;
  /** ICP-Brasil e-CNPJ otherName; omitted to mimic a non e-CNPJ certificate. */
  cnpj?: string;
  notBefore?: Date;
  notAfter?: Date;
}

/** Self-signed A1 bundle shaped like an ICP-Brasil e-CNPJ. */
export function makePfx(options: MakePfxOptions): Buffer {
  const { privateKey: pem } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const key = forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey;

  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  cert.serialNumber = "0a1b2c";
  cert.validity.notBefore = options.notBefore ?? new Date("2026-01-01T00:00:00Z");
  cert.validity.notAfter = options.notAfter ?? new Date("2027-01-01T00:00:00Z");
  const subject = [{ shortName: "CN", value: `EMPRESA TESTE LTDA:${options.cnpj ?? "00000000000000"}` }];
  cert.setSubject(subject);
  cert.setIssuer([{ shortName: "CN", value: "AC TESTE" }]);

  if (options.cnpj) {
    const { asn1 } = forge;
    const otherName = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer("2.16.76.1.3.3").getBytes()),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, options.cnpj),
      ]),
    ]);
    const san = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [otherName]);
    cert.setExtensions([{ id: "2.5.29.17", value: asn1.toDer(san).getBytes() }]);
  }
  cert.sign(key, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], options.password, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}
