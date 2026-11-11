// Emits one real export NFS-e (foreign taker, comExt) in produção restrita
// (tpAmb=2, no fiscal effect) through the BUILT package.
//
// usage: pnpm build && node scripts/smoke-export-restricted.mjs <pfx> <password-file> <cMun> <cNBS> <cTribNac>
import { readFileSync } from "node:fs";
import { loadCertificate } from "../dist/index.js";
import { buildDps, signDps, SefinClient, SefinError } from "../dist/nfse/index.js";

const [pfxPath, passwordFile, cMun = "4208203", cNBS = "114012900", cTribNac = "170303"] =
  process.argv.slice(2);

const certificate = loadCertificate(readFileSync(pfxPath), readFileSync(passwordFile, "utf8"));
console.log("certificate", certificate.cnpj, certificate.subjectName, certificate.validTo.toISOString());

const now = new Date();
const dps = buildDps({
  environment: "restricted",
  dhEmi: now,
  dCompet: new Date(now.getTime() - 3 * 3600e3).toISOString().slice(0, 10),
  serie: "00901",
  nDPS: String(Math.floor(now.getTime() / 1000)),
  cLocEmi: cMun,
  verAplic: "bullcode-fiscal",
  prest: { CNPJ: certificate.cnpj, regTrib: { opSimpNac: 3, regApTribSN: 1, regEspTrib: 0 } },
  toma: {
    NIF: "98-7654321",
    xNome: "ACME INC",
    end: {
      cPais: "US",
      cEndPost: "94105",
      xCidade: "San Francisco",
      xEstProvReg: "CA",
      xLgr: "Market St",
      nro: "1",
      xBairro: "SoMa",
    },
  },
  serv: {
    cLocPrestacao: cMun,
    cTribNac,
    cNBS,
    xDescServ: "TESTE HOMOLOGACAO EXPORTACAO @bullcode/fiscal",
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
  valores: { vServ: 10000, tribISSQN: 3, tpRetISSQN: 1, totTrib: { pTotTribSN: 6 } },
  IBSCBS: { indFinal: 0, cIndOp: "100301", indDest: 0, CST: "000", cClassTrib: "000001" },
});

const client = new SefinClient({ environment: "restricted", certificate });
try {
  const issued = await client.emit(signDps(dps.xml, certificate));
  console.log("emitted", issued.accessKey, "nNFSe", issued.nfseXml.match(/<nNFSe>(\d+)/)?.[1]);
  console.log("findAccessKeyByDpsId", await client.findAccessKeyByDpsId(dps.id));
  console.log("findAccessKeyByDpsId(unknown)", await client.findAccessKeyByDpsId(dps.id.slice(0, -1) + "9"));
  const xml = await client.getNfseXml(issued.accessKey);
  console.log("getNfseXml", xml.includes(issued.accessKey) ? "ok" : "MISMATCH");
} catch (error) {
  if (error instanceof SefinError) console.log("SefinError", error.kind, error.httpStatus, error.messages);
  else throw error;
}
