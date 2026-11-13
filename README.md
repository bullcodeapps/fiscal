# @bullcode/fiscal

[![CI](https://github.com/bullcodeapps/fiscal/actions/workflows/ci.yml/badge.svg)](https://github.com/bullcodeapps/fiscal/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@bullcode/fiscal)](https://www.npmjs.com/package/@bullcode/fiscal)
[![skills.sh](https://skills.sh/b/bullcodeapps/fiscal)](https://skills.sh/bullcodeapps/fiscal)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Brazilian fiscal documents for Node.js (>= 20.11, ESM and CommonJS). Today it issues NFS-e Nacional directly
against Sefin Nacional, with no intermediary and no per-note fee: it loads the A1 e-CNPJ certificate, builds and
signs the DPS, emits over mTLS, reconciles after timeouts, cancels, imports notes from the ADN and renders the
DANFSe PDF. The library is stateless: storage of certificates, DPS numbering and persistence of notes belong to the app.

- `@bullcode/fiscal`: certificate loading (ICP-Brasil A1), XMLDSig signing, IBGE municipality lookup
- `@bullcode/fiscal/nfse`: DPS builder, Sefin client, cancellation, ADN client, note summary, DANFSe

## Install

```sh
pnpm add @bullcode/fiscal   # or: npm install @bullcode/fiscal
```

Releases and changes: [npm](https://www.npmjs.com/package/@bullcode/fiscal), [CHANGELOG.md](./CHANGELOG.md).

## Quick start

```ts
import { readFileSync } from "node:fs";
import { loadCertificate } from "@bullcode/fiscal";
import { buildDps, renderDanfse, SefinClient, signDps } from "@bullcode/fiscal/nfse";

const certificate = loadCertificate(readFileSync("cert.pfx"), process.env.CERT_PASSWORD!);

const dps = buildDps({
  environment: "restricted", // produção restrita: real Sefin, no fiscal effect
  dhEmi: new Date(),
  dCompet: "2026-11-12",
  serie: "00001",
  nDPS: "1", // from your own atomic counter
  cLocEmi: "4208203",
  verAplic: "my-app-1.0",
  prest: { CNPJ: certificate.cnpj, regTrib: { opSimpNac: 3, regApTribSN: 1, regEspTrib: 0 } },
  toma: {
    CNPJ: "00000000000191",
    xNome: "BANCO DO BRASIL SA",
    end: { cMun: "5300108", CEP: "70040912", xLgr: "SAUN QUADRA 5 LOTE B", nro: "SN", xBairro: "ASA NORTE" },
  },
  serv: { cLocPrestacao: "4208203", cTribNac: "170303", cNBS: "114012900", xDescServ: "Consultoria administrativa" },
  valores: { vServ: 1500, tribISSQN: 1, tpRetISSQN: 1, totTrib: { pTotTribSN: 6 } },
  IBSCBS: { indFinal: 0, cIndOp: "100301", indDest: 0, CST: "000", cClassTrib: "000001" },
});

const client = new SefinClient({ environment: "restricted", certificate });
// Throws SefinError. On "unavailable" the DPS may have been authorized: never send a new number, reconcile
// with findAccessKeyByDpsId(dps.id) as the integration guide shows.
const { accessKey, nfseXml } = await client.emit(signDps(dps.xml, certificate));
const pdf = await renderDanfse(nfseXml);
```

A production integration also needs persistence, numbering and the retry loop. The
[integration guide](./docs/integration.md) has all of it, with a complete reference implementation.

## Docs

- [docs/integration.md](./docs/integration.md): end-to-end flow, reference implementation, checklist
- [docs/dps-input.md](./docs/dps-input.md): every `DpsInput` field, complete inputs for company, person and export
- [docs/codes.md](./docs/codes.md): where to look up each tax code, municipality adhesion, common Sefin rejections
- [docs/errors.md](./docs/errors.md): every error the library defines and how to fix it

The docs ship inside the package, at `node_modules/@bullcode/fiscal/docs/`, and always match the installed version.

## Using with AI coding agents

The docs are written so an agent can implement a full integration from them. Paste this block into your
project's `AGENTS.md` (or `CLAUDE.md`):

```md
## NFS-e (@bullcode/fiscal)

Before writing any code that issues, cancels, queries or renders NFS-e, read the docs that ship with the
installed version, in this order, and prefer them over prior knowledge:

1. node_modules/@bullcode/fiscal/docs/integration.md (follow its checklist)
2. node_modules/@bullcode/fiscal/docs/dps-input.md
3. node_modules/@bullcode/fiscal/docs/codes.md (tax codes and Sefin rejection codes)
4. node_modules/@bullcode/fiscal/docs/errors.md
```

Agents that support [Agent Skills](https://agentskills.io) can also install the skill in `skills/nfse-integration`
([skills.sh](https://skills.sh/bullcodeapps/fiscal/nfse-integration)):

```sh
npx skills add bullcodeapps/fiscal
```

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`packageManager` pins pnpm 10. See [AGENTS.md](./AGENTS.md) for contributor notes.

### Layout

Sefin validates each environment against its own schema, and `buildDps` follows `environment`:

- produção: `nfse-esquemas_xsd-v1-01-20260209` (`finNFSe` inside `IBSCBS`, `gIBSCBS`, `cNBS` after `xDescServ`)
- produção restrita: the NT 009 schema `esquemas_prod_restrita_20261020` (`test/fixtures` holds DPS bodies it authorized)

`test/xsd` holds both schema sets and `test/schema.test.ts` validates the builder against them. When NT 009 reaches
produção, flip `usesNt009Layout` and replace `test/xsd/production`. The XSD copies drop the `^…$` anchors from their
patterns, which libxml2 would otherwise read as literal characters.

### Smoke tests

Each script emits a real note in produção restrita (no fiscal effect):

```sh
pnpm build && node scripts/smoke-restricted.mjs cert.pfx password.txt          # domestic taker
pnpm build && node scripts/smoke-export-restricted.mjs cert.pfx password.txt   # foreign taker
pnpm build && node scripts/cancel-restricted.mjs cert.pfx password.txt <accessKey>
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md). Report security
problems privately, as [SECURITY.md](./SECURITY.md) describes.

## License

[MIT](./LICENSE)
