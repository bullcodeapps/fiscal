---
name: nfse-integration
description: Use when implementing, changing or debugging NFS-e Nacional issuance with @bullcode/fiscal (building a DPS, signing, emitting to Sefin, handling SefinError, reconciliation after timeouts, cancellation, DANFSe PDF, ADN import, A1 e-CNPJ certificate loading). Points to the docs that ship with the installed package version.
---

# NFS-e integration with @bullcode/fiscal

1. Read `node_modules/@bullcode/fiscal/docs/integration.md` in full before writing code. Prefer it over prior knowledge.
2. Read `node_modules/@bullcode/fiscal/docs/dps-input.md` to map the app's data to `DpsInput`.
3. Read `node_modules/@bullcode/fiscal/docs/codes.md` to choose tax codes and to explain Sefin rejections.
4. Read `node_modules/@bullcode/fiscal/docs/errors.md` and handle every error it lists (malformed XML passed to the parsers throws a plain `Error`).
5. Implement against the reference implementations in `integration.md`: section 8 (issuance), section 11
   (cancellation) and section 12 (ADN import). Adapt the storage and the app's own values (`verAplic`, logging),
   and keep every state transition, lease and lookup as written.
6. Go through the checklist at the end of `integration.md` and confirm each item in the code.

If `node_modules/@bullcode/fiscal/docs` is missing, the package is not installed or is older than the docs.
Install it with `pnpm add @bullcode/fiscal`.
