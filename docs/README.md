# @bullcode/fiscal docs

These files ship with the package (`node_modules/@bullcode/fiscal/docs/`) and match the installed version.
Prefer them over prior knowledge: NFS-e Nacional changes often and is barely covered by training data.

Read in this order:

1. [integration.md](./integration.md): end-to-end flow (certificate, numbering, storage, emit, error handling,
   reconciliation, DANFSe, cancellation, ADN import) with a complete reference implementation and a checklist.
2. [dps-input.md](./dps-input.md): every `DpsInput` field, the rules `buildDps` enforces, and complete inputs
   for a company, a person and an export.
3. [errors.md](./errors.md): every error the package throws, what it means and how to fix it.

Entry points:

- `@bullcode/fiscal`: `loadCertificate`, `CertificateError`, `signEnveloped`, `findMunicipalityCode`, `findMunicipality`
- `@bullcode/fiscal/nfse`: `buildDps`, `dpsId`, `signDps`, `SefinClient`, `SefinError`, `buildCancellation`,
  `renderDanfse`, `buildDanfseModel`, `readNfseSummary`, `readNfseEventSummary`, `AdnClient`, `AdnError`

The `.d.ts` files carry TSDoc on the input fields and code tables.
