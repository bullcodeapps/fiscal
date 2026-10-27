// Cancels one NFS-e in produção restrita (no fiscal effect), then repeats the
// request to show how Sefin rejects a duplicate event.
// usage: pnpm build && node scripts/cancel-restricted.mjs <pfx> <password-file> <access-key>
import { readFileSync } from "node:fs";
import { loadCertificate } from "../dist/index.js";
import { buildCancellation, SefinClient, SefinError } from "../dist/nfse/index.js";

const [pfxPath, passwordFile, accessKey] = process.argv.slice(2);
const certificate = loadCertificate(readFileSync(pfxPath), readFileSync(passwordFile, "utf8"));
const client = new SefinClient({ environment: "restricted", certificate });
const request = () =>
  buildCancellation(
    {
      environment: "restricted",
      accessKey,
      authorCnpj: certificate.cnpj,
      reason: 1,
      description: "Teste de cancelamento em producao restrita",
      verAplic: "bullcode-fiscal",
      at: new Date(),
    },
    certificate,
  );

for (const attempt of ["first", "repeat"]) {
  try {
    const eventXml = await client.registerEvent(accessKey, request());
    console.log(attempt, "registered", eventXml.match(/<nSeqEvento>(\d+)/)?.[1], eventXml.match(/<tpEvento>(\d+)|e101101/)?.[0]);
  } catch (error) {
    if (error instanceof SefinError) console.log(attempt, "SefinError", error.kind, error.httpStatus, JSON.stringify(error.messages));
    else throw error;
  }
}
const nfse = await client.getNfseXml(accessKey).catch((e) => `ERR ${e.message}`);
console.log("after", typeof nfse === "string" ? nfse.slice(0, 80) : nfse);
