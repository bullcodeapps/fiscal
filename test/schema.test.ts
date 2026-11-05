import { readdirSync, readFileSync } from "node:fs";
import { validateXML } from "xmllint-wasm";
import { describe, expect, it } from "vitest";
import { loadCertificate } from "../src";
import type { Environment } from "../src/core/environment";
import { buildCancellation, buildDps, type DpsInput } from "../src/nfse";
import { makePfx } from "./make-pfx";

// test/xsd holds Sefin's published schemas: production is
// nfse-esquemas_xsd-v1-01-20260209, restricted is esquemas_prod_restrita_20261020.
async function validate(environment: Environment, mainSchema: string, xml: string) {
  const dir = new URL(`./xsd/${environment}/`, import.meta.url);
  const file = (fileName: string) => ({ fileName, contents: readFileSync(new URL(fileName, dir), "utf8") });
  const result = await validateXML({
    xml: [{ fileName: "doc.xml", contents: xml }],
    schema: [file(mainSchema)],
    preload: readdirSync(dir)
      .filter((name) => name.endsWith(".xsd") && name !== mainSchema)
      .map(file),
  });
  return result.errors.map((error) => error.message);
}

const consumerDps = (environment: Environment): DpsInput => ({
  environment,
  dhEmi: new Date("2026-11-05T16:48:11Z"),
  dCompet: "2026-11-02",
  serie: "00800",
  nDPS: "1",
  cLocEmi: "4208302",
  verAplic: "floraclin",
  prest: {
    CNPJ: "64643544000154",
    IM: "38923",
    regTrib: { opSimpNac: 3, regApTribSN: 1, regEspTrib: 0 },
  },
  toma: {
    CPF: "52998224725",
    xNome: "PACIENTE TESTE",
    email: "paciente@example.com",
    end: {
      cMun: "4208302",
      CEP: "88220000",
      xLgr: "RUA 406A",
      nro: "10",
      xCpl: "SALA 02",
      xBairro: "MORRETES",
    },
  },
  serv: { cLocPrestacao: "4208302", cTribNac: "060201", cNBS: "126029000", xDescServ: "Procedimento estetico" },
  valores: { vServ: 1300, tribISSQN: 1, tpRetISSQN: 1, totTrib: { pTotTribSN: 6 } },
  IBSCBS: { indFinal: 1, cIndOp: "100301", indDest: 0, CST: "000", cClassTrib: "000001" },
});

describe("Sefin schemas", () => {
  it.each<Environment>(["production", "restricted"])("a consumer DPS matches the %s schema", async (environment) => {
    expect(await validate(environment, "DPS_v1.01.xsd", buildDps(consumerDps(environment)).xml)).toEqual([]);
  });

  it.each<Environment>(["production", "restricted"])("a cancellation matches the %s schema", async (environment) => {
    const certificate = loadCertificate(makePfx({ password: "x", cnpj: "64643544000154" }), "x");
    const xml = buildCancellation(
      {
        environment,
        accessKey: "42083022264643544000154000000000000126110000000001",
        authorCnpj: "64643544000154",
        reason: 2,
        description: "Pagamento estornado no sistema.",
        verAplic: "floraclin",
        at: new Date("2026-11-05T16:48:11Z"),
      },
      certificate,
    );
    expect(await validate(environment, "pedRegEvento_v1.01.xsd", xml)).toEqual([]);
  });
});
