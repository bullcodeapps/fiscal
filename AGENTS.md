# AGENTS.md

Contributor guide for `@bullcode/fiscal`. If you are integrating the library into an app, read
[docs/README.md](./docs/README.md) instead.

## Overview

Stateless TypeScript library for Brazilian fiscal documents. Today: NFS-e Nacional.

- `src/core`: certificate loading (node-forge, because OpenSSL 3 rejects many Brazilian A1 bundles), XMLDSig, XML helpers, IBGE municipalities
- `src/nfse`: DPS builder (`dps.ts`), signing, Sefin client, events (cancellation), ADN client, summary, DANFSe (`danfse/`)
- `src/index.ts` and `src/nfse/index.ts` are the only public entry points. Anything exported there is public API.

## Commands

pnpm 10 is pinned in `packageManager`. Older global pnpm versions fail on `pnpm-workspace.yaml`; use `npx pnpm@10` if needed.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check:docs   # builds, then type-checks every ts block in README.md and docs/
```

## Releases

Consumers install from npm. To release:

1. Bump `version` in `package.json` and add the entry to `CHANGELOG.md`.
2. Tag `vX.Y.Z` on `main` and push the tag.
3. Run `pnpm publish`. `prepublishOnly` runs typecheck, tests and `check:docs` (which builds `dist`).

## Tests

- `test/schema.test.ts` validates `buildDps` output against the official XSDs in `test/xsd/production` and `test/xsd/restricted`.
  The XSD copies drop the `^…$` pattern anchors, which libxml2 would read as literal characters.
- `test/dps.test.ts` compares builder output with DPS bodies that produção restrita authorized (`test/fixtures/accepted-*.xml`).
- `test/make-pfx.ts` generates throwaway e-CNPJ certificates for signing tests.
- The fixtures are anonymized (the common example CNPJ `11222333000181`, fake address and contact) and their
  `<Signature>` elements were removed. Nothing verifies fixture signatures.

## Rules

- Never commit certificates, passwords, personal data (names of people, CPF, emails, phones, personal
  addresses) or data of private taxpayers. Anonymize any XML captured from Sefin before adding it as a fixture,
  and drop its `<Signature>` elements: the `X509Certificate` inside carries the representative's CPF.
  The public registry data of Banco do Brasil (CNPJ 00000000000191), the usual test taker in produção
  restrita, is fine.
- Keep the field names of `DpsInput` equal to the official layout names.
- Every Sefin rule that the XSD does not express goes in `assertExportRules`-style checks in `dps.ts`, with the Sefin code in the message.
- When behavior changes, update `docs/` in the same commit. Agents in consumer apps read those files from `node_modules`.
