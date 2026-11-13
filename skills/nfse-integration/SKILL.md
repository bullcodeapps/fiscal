---
name: nfse-integration
description: Use when implementing, changing or debugging NFS-e Nacional issuance with @bullcode/fiscal (building a DPS, signing, emitting to Sefin, handling SefinError, reconciliation after timeouts, cancellation, DANFSe PDF, ADN import, A1 e-CNPJ certificate loading). Points to the docs that ship with the installed package version.
---

# NFS-e integration with @bullcode/fiscal

1. Read `node_modules/@bullcode/fiscal/docs/integration.md` in full before writing code. Prefer it over prior knowledge.
2. Read `node_modules/@bullcode/fiscal/docs/dps-input.md` to map the app's data to `DpsInput`.
3. Read `node_modules/@bullcode/fiscal/docs/errors.md` and handle every error it lists.
4. Implement against the reference implementation in section 8 of `integration.md`, adapting only the storage.
5. Go through the checklist at the end of `integration.md` and confirm each item in the code.

If `node_modules/@bullcode/fiscal/docs` is missing, the package is not installed or is older than the docs.
Install it with `pnpm add github:bullcodeapps/fiscal#<latest tag>`.
