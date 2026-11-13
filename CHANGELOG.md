# Changelog

Install a version with `pnpm add github:bullcodeapps/fiscal#<tag>`.

## v0.3.3 (2026-11-12)

- Docs that ship in the package (`docs/`): integration guide with a reference implementation, `DpsInput`
  reference, error reference. AGENTS.md, an Agent Skill and TSDoc on the main entry points.
- `docs/codes.md`: where to look up each tax code, municipality adhesion, common Sefin rejection codes.
- `buildDps` rejects a `cLocEmi`, `prest.CNPJ`, `serie` or `nDPS` that is not digits of the right length, and
  `buildCancellation` does the same for `accessKey` and `authorCnpj`. **Breaking** for inputs with masked
  values (for example a CNPJ with dots), which Sefin rejected anyway (E0004).
- node-forge 1.4.3 and fast-xml-parser 5.12.0 (security advisories).
- Pins pnpm 10 in `packageManager`.

## v0.3.2 (2026-11-12)

- `valores.cPaisResult` (country of the result) for exported services. `buildDps` requires it when
  `tribISSQN` is 3 (Sefin E0590). **Breaking** for export inputs that omitted it.

## v0.3.1 (2026-11-12)

- `AdnClient` sends `cnpjConsulta`. Since 2026-11-03 the ADN refuses distribution queries without it.
  `AdnClientOptions.cnpj` is now required.

## v0.3.0 (2026-11-12)

- `AdnClient`: distribution of the notes and events where the CNPJ is provider, taker or intermediary.
- `readNfseEventSummary`, and more fields in `readNfseSummary` (provider, taker name and NIF, issue time, ISSQN).

## v0.2.1 (2026-11-11)

- `buildDps` enforces the export rules the XSD does not (E0223, E0330).
- DANFSe shows the foreign taker country once.

## v0.2.0 (2026-11-11)

- Foreign takers (`NIF` / `cNaoNIF`, foreign address) and export of services (`serv.comExt`).
- `readNfseSummary` returns the NFS-e number.

## v0.1.2 (2026-11-05)

- `buildDps` emits the layout each Sefin environment validates (produção vs. NT 009 in produção restrita).

## v0.1.1 (2026-10-27)

- `dist` is committed, so git installs never build.

## v0.1.0 (2026-10-27)

- NFS-e Nacional emission: certificate loading, DPS builder, XMLDSig, Sefin client, cancellation, DANFSe.
