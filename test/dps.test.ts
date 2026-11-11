import { readFileSync } from "node:fs";
import { SignedXml } from "xml-crypto";
import { describe, expect, it } from "vitest";
import { loadCertificate } from "../src";
import { buildDps, signDps, type DpsInput } from "../src/nfse";
import { makePfx } from "./make-pfx";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}.xml`, import.meta.url), "utf8").trim();

// Both fixtures are the exact DPS bodies Sefin produção restrita authorized
// on 2026-10-26 (NFS-e 1 and 2 of CNPJ 11222333000181).
const accepted: DpsInput = {
  environment: "restricted",
  dhEmi: new Date("2026-10-26T19:20:30Z"),
  dCompet: "2026-10-26",
  serie: "00900",
  nDPS: "1793042430",
  cLocEmi: "4208203",
  verAplic: "fiscal-test-1",
  prest: {
    CNPJ: "11222333000181",
    regTrib: { opSimpNac: 3, regApTribSN: 1, regEspTrib: 0 },
  },
  toma: {
    CNPJ: "00000000000191",
    xNome: "BANCO DO BRASIL SA",
    end: {
      cMun: "5300108",
      CEP: "70040912",
      xLgr: "SAUN QUADRA 5 LOTE B",
      nro: "SN",
      xBairro: "ASA NORTE",
    },
  },
  serv: {
    cLocPrestacao: "4208203",
    cTribNac: "170303",
    cNBS: "114012900",
    xDescServ: "TESTE HOMOLOGACAO NT009 c",
  },
  valores: { vServ: 10, tribISSQN: 1, tpRetISSQN: 1, totTrib: { pTotTribSN: 6 } },
  IBSCBS: { indFinal: 0, cIndOp: "100301", indDest: 0, CST: "000", cClassTrib: "000001" },
};

describe("buildDps", () => {
  it.each([
    { name: "accepted-170303", input: accepted },
    {
      name: "accepted-990401",
      input: {
        ...accepted,
        dhEmi: new Date("2026-10-26T19:21:03Z"),
        nDPS: "1793042463",
        serv: {
          ...accepted.serv,
          cTribNac: "990401",
          cNBS: "111011500",
          xDescServ: "TESTE HOMOLOGACAO NT009 d",
        },
        valores: { ...accepted.valores, tribISSQN: 4 },
        IBSCBS: {
          ...accepted.IBSCBS!,
          bensMoveis: [
            {
              cNCMBemMovel: "89039900",
              xNCMBemMovel: "JET SKI SEA-DOO WAKE PRO 230",
              qtdNCMBemMovel: 1,
            },
          ],
        },
      } satisfies DpsInput,
    },
  ])("reproduces the DPS Sefin authorized ($name)", ({ name, input }) => {
    expect(buildDps(input).xml).toBe(fixture(name));
  });
});

describe("export of services", () => {
  const exported: DpsInput = {
    ...accepted,
    toma: { NIF: "98-7654321", xNome: "ACME INC" },
    serv: {
      ...accepted.serv,
      comExt: {
        mdPrestacao: 1,
        vincPrest: 0,
        tpMoeda: "220",
        vServMoeda: 2000,
        mecAFComexP: "01",
        mecAFComexT: "01",
        movTempBens: 1,
        mdic: 0,
      },
    },
  };

  it("places comExt after cServ and before valores", () => {
    const { xml } = buildDps(exported);
    const at = (tag: string) => xml.indexOf(`<${tag}>`);

    expect(at("cServ")).toBeGreaterThan(-1);
    expect(at("comExt")).toBeGreaterThan(xml.indexOf("</cServ>"));
    expect(at("comExt")).toBeLessThan(at("valores"));
    expect(xml).toContain("<vServMoeda>2000.00</vServMoeda>");
  });

  it("rejects a service with both cLocPrestacao and cPaisPrestacao", () => {
    expect(() =>
      buildDps({ ...exported, serv: { ...exported.serv, cPaisPrestacao: "US" } }),
    ).toThrow("serv: exactly one of cLocPrestacao or cPaisPrestacao");
  });

  it("rejects a service with neither cLocPrestacao nor cPaisPrestacao", () => {
    expect(() =>
      buildDps({ ...exported, serv: { ...exported.serv, cLocPrestacao: undefined } }),
    ).toThrow("serv: exactly one of cLocPrestacao or cPaisPrestacao");
  });
});

describe("signDps", () => {
  it("signs infDPS so that any change to the declared values breaks the signature", () => {
    const certificate = loadCertificate(
      makePfx({ password: "x", cnpj: "11222333000181" }),
      "x",
    );
    const signed = signDps(buildDps(accepted).xml, certificate);

    const verify = (xml: string) => {
      const signature = xml.match(/<Signature[\s\S]*<\/Signature>/)![0];
      const verifier = new SignedXml({ publicCert: certificate.certificatePem });
      verifier.loadSignature(signature);
      return verifier.checkSignature(xml);
    };

    expect(verify(signed)).toBe(true);
    expect(verify(signed.replace("<vServ>10.00</vServ>", "<vServ>1.00</vServ>"))).toBe(false);
  });
});
