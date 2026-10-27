import { describe, expect, it } from "vitest";
import forge from "node-forge";
import { CertificateError, loadCertificate } from "../src";
import { makePfx } from "./make-pfx";

describe("loadCertificate", () => {
  it("reads the e-CNPJ holder, validity and key pair from an A1 bundle", () => {
    const pfx = makePfx({ password: "s3cret", cnpj: "12345678000195" });

    const certificate = loadCertificate(pfx, "s3cret");

    expect(certificate).toMatchObject({
      cnpj: "12345678000195",
      subjectName: "EMPRESA TESTE LTDA:12345678000195",
      issuerName: "AC TESTE",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2027-01-01T00:00:00Z"),
    });
    expect(certificate.privateKeyPem).toContain("PRIVATE KEY");
    expect(certificate.certificatePem).toContain("BEGIN CERTIFICATE");
  });

  it.each([
    {
      scenario: "wrong password",
      pfx: () => makePfx({ password: "s3cret", cnpj: "12345678000195" }),
      password: "wrong",
      code: "unreadable",
    },
    {
      scenario: "not a PKCS#12 file",
      pfx: () => Buffer.from("not a certificate"),
      password: "s3cret",
      code: "unreadable",
    },
    {
      // A huge MAC iteration count would freeze the event loop inside forge.
      scenario: "an iteration count above the cap",
      pfx: () => withMacIterations(makePfx({ password: "s3cret", cnpj: "12345678000195" }), 2_000_000_000),
      password: "s3cret",
      code: "unreadable",
    },
    {
      scenario: "certificate without the ICP-Brasil CNPJ otherName",
      pfx: () => makePfx({ password: "s3cret" }),
      password: "s3cret",
      code: "missing_cnpj",
    },
  ])("rejects $scenario", ({ pfx, password, code }) => {
    const bundle = pfx();
    let error: unknown;
    try {
      loadCertificate(bundle, password);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(CertificateError);
    expect((error as CertificateError).code).toBe(code);
  });
});

/** Rewrites the MacData iteration count of a PFX (last child of the outer SEQUENCE). */
function withMacIterations(pfx: Buffer, iterations: number): Buffer {
  const root = forge.asn1.fromDer(pfx.toString("binary"));
  const macData = (root.value as forge.asn1.Asn1[])[2];
  const count = (macData.value as forge.asn1.Asn1[])[2];
  count.value = forge.util.hexToBytes(iterations.toString(16).padStart(8, "0"));
  return Buffer.from(forge.asn1.toDer(root).getBytes(), "binary");
}
