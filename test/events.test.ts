import { SignedXml } from "xml-crypto";
import { describe, expect, it } from "vitest";
import { loadCertificate } from "../src";
import { buildCancellation } from "../src/nfse";
import { makePfx } from "./make-pfx";

const certificate = loadCertificate(makePfx({ password: "x", cnpj: "64643544000154" }), "x");
const ACCESS_KEY = "42082032264643544000154000000000000426100762796533";

const input = {
  environment: "restricted" as const,
  accessKey: ACCESS_KEY,
  authorCnpj: "64643544000154",
  reason: 1 as const,
  description: "Teste de cancelamento em producao restrita",
  verAplic: "bullcode-fiscal",
  at: new Date("2026-10-26T22:00:00Z"),
};

describe("buildCancellation", () => {
  // Same shape Sefin produção restrita registered on 2026-10-26 (NFS-e 4).
  it("builds a signed e101101 request keyed PRE + access key + event type", () => {
    const xml = buildCancellation(input, certificate);

    expect(xml).toContain(`<infPedReg Id="PRE${ACCESS_KEY}101101">`);
    expect(xml).toContain(
      "<tpAmb>2</tpAmb><verAplic>bullcode-fiscal</verAplic><dhEvento>2026-10-26T19:00:00-03:00</dhEvento>" +
        `<CNPJAutor>64643544000154</CNPJAutor><chNFSe>${ACCESS_KEY}</chNFSe>` +
        "<e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo>" +
        "<xMotivo>Teste de cancelamento em producao restrita</xMotivo></e101101>",
    );
    const verifier = new SignedXml({ publicCert: certificate.certificatePem });
    verifier.loadSignature(xml.match(/<Signature[\s\S]*<\/Signature>/)![0]);
    expect(verifier.checkSignature(xml)).toBe(true);
  });

  it.each(["curto demais", "x".repeat(256)])("rejects a justification outside 15-255 characters", (description) => {
    expect(() => buildCancellation({ ...input, description }, certificate)).toThrow(RangeError);
  });
});
