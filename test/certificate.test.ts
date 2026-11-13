import { describe, expect, it } from "vitest";
import forge from "node-forge";
import { CertificateError, loadCertificate } from "../src";
import { makePfx } from "./make-pfx";

describe("loadCertificate", () => {
  it("reads the e-CNPJ holder, validity and key pair from an A1 bundle", () => {
    const pfx = makePfx({ password: "s3cret", cnpj: "11222333000181" });

    const certificate = loadCertificate(pfx, "s3cret");

    expect(certificate).toMatchObject({
      cnpj: "11222333000181",
      subjectName: "EMPRESA TESTE LTDA:11222333000181",
      issuerName: "AC TESTE",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2027-01-01T00:00:00Z"),
    });
    expect(certificate.privateKeyPem).toContain("PRIVATE KEY");
    expect(certificate.certificatePem).toContain("BEGIN CERTIFICATE");
  });

  it("keeps the letters of an alphanumeric CNPJ", () => {
    const certificate = loadCertificate(makePfx({ password: "x", cnpj: "12ABC34501DE35" }), "x");

    expect(certificate.cnpj).toBe("12ABC34501DE35");
  });

  it.each([
    {
      scenario: "wrong password",
      pfx: () => makePfx({ password: "s3cret", cnpj: "11222333000181" }),
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
      pfx: () => withMacIterations(makePfx({ password: "s3cret", cnpj: "11222333000181" }), 2_000_000_000),
      password: "s3cret",
      code: "unreadable",
    },
    {
      // Each count passes the per-value cap, but forge runs all three derivations back to back.
      scenario: "a total iteration count above the cap",
      pfx: () => makePfx({ password: "s3cret", cnpj: "11222333000181", count: 160_000 }),
      password: "s3cret",
      code: "unreadable",
    },
    {
      // A valid bundle, but real A1 files are a few KB; a large one is parsed synchronously.
      scenario: "a file over 64 KB",
      pfx: () => makePfx({ password: "s3cret", cnpj: "11222333000181", padCertificates: 100 }),
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
