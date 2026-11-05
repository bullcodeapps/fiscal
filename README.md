# @bullcode/fiscal

Brazilian fiscal documents for Node.js (>= 20.11, CommonJS and ESM).

- `@bullcode/fiscal`: shared core. A1 certificate loading (ICP-Brasil e-CNPJ) and XMLDSig signing.
- `@bullcode/fiscal/nfse`: NFS-e Nacional emission. DPS builder, signer, Sefin Nacional mTLS client.

Storage of certificates, numbering of DPS and persistence of issued notes belong to the app.

## Install

```sh
pnpm add git+https://github.com/bullcodeapps/fiscal.git#v0.1.1
```

`dist` is committed, so installs never build. Run `pnpm build` and commit `dist` before tagging a release.

## Emit an NFS-e

```ts
import { loadCertificate } from "@bullcode/fiscal";
import { buildDps, signDps, SefinClient, SefinError } from "@bullcode/fiscal/nfse";

const certificate = loadCertificate(pfxBuffer, password);
const dps = buildDps({ environment: "restricted", /* ...DpsInput */ });
const client = new SefinClient({ environment: "restricted", certificate });

try {
  const { accessKey, nfseXml } = await client.emit(signDps(dps.xml, certificate));
} catch (error) {
  if (error instanceof SefinError && error.kind === "unavailable") {
    // The DPS may have been authorized. Reconcile before resending:
    const accessKey = await client.findAccessKeyByDpsId(dps.id);
  }
}
```

`DpsInput` uses the official layout field names (`cTribNac`, `cNBS`, `cIndOp`, ...), so every field maps to the
Anexo I / VI spreadsheets at https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica.

## Layout

Sefin validates each environment against its own schema, and `buildDps` follows `environment`:

- produção: `nfse-esquemas_xsd-v1-01-20260209` (`finNFSe` inside `IBSCBS`, `gIBSCBS`, `cNBS` after `xDescServ`)
- produção restrita: the NT 009 schema `esquemas_prod_restrita_20261020` (`test/fixtures` holds DPS bodies it authorized)

`test/xsd` holds both schema sets and `test/schema.test.ts` validates the builder against them. When NT 009 reaches
produção, flip `usesNt009Layout` and replace `test/xsd/production`. The XSD copies drop the `^…$` anchors from their
patterns, which libxml2 would otherwise read as literal characters.

## Smoke test

Emits one real note in produção restrita (no fiscal effect):

```sh
pnpm build && node scripts/smoke-restricted.mjs cert.pfx password.txt
```
