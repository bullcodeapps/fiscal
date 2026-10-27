// Emits one real NFS-e in produção restrita (tpAmb=2, no fiscal effect)
// through the BUILT package, then exercises the reconciliation endpoints.
//
// usage: pnpm build && node scripts/smoke-restricted.mjs <pfx> <password-file> <cMun> <cNBS> <cTribNac>
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
  serie: "00900",
  nDPS: String(Math.floor(now.getTime() / 1000)),
  cLocEmi: cMun,
  verAplic: "bullcode-fiscal",
  prest: { CNPJ: certificate.cnpj, regTrib: { opSimpNac: 3, regApTribSN: 1, regEspTrib: 0 } },
  toma: {
    CNPJ: "00000000000191",
    xNome: "BANCO DO BRASIL SA",
    end: { cMun: "5300108", CEP: "70040912", xLgr: "SAUN QUADRA 5 LOTE B", nro: "SN", xBairro: "ASA NORTE" },
  },
  serv: { cLocPrestacao: cMun, cTribNac, cNBS, xDescServ: "TESTE HOMOLOGACAO @bullcode/fiscal" },
  valores: { vServ: 10, tribISSQN: 1, tpRetISSQN: 1, totTrib: { pTotTribSN: 6 } },
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
