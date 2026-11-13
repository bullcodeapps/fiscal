# Changelog

Install a version with `pnpm add github:bullcodeapps/fiscal#<tag>`.

## v0.3.3 (2026-11-12)

- Docs that ship in the package (`docs/`): integration guide with a reference implementation, `DpsInput`
  reference, error reference. AGENTS.md, an Agent Skill and TSDoc on the main entry points.
- `docs/codes.md`: where to look up each tax code, municipality adhesion, common Sefin rejection codes.
- Alphanumeric CNPJ (`[0-9A-Z]{14}`) in `loadCertificate`, `buildDps`, `buildCancellation` and `AdnClient`.
- `buildDps` rejects a `cLocEmi`, `prest.CNPJ`, `serie` or `nDPS` with the wrong length or characters, and
  `buildCancellation` does the same for `accessKey` and `authorCnpj`. **Breaking** for inputs with masked
  values (for example a CNPJ with dots), which Sefin rejected anyway (E0004).
- DANFSe reads `finNFSe` and `CST` / `cClassTrib` in the produção layout too (they showed "-").
- Sefin and ADN answers over 10 MB (compressed or decompressed), and malformed gzip or base64, throw
  `SefinError` / `AdnError` `unavailable` instead of raw errors.
- `loadCertificate` refuses files over 64 KB and more than 300,000 key-derivation iterations in total.
- `isNfseOfDps(nfseXml, signedDpsXml)`: true when a note embeds exactly this signed DPS. Use it after
  reconciliation.
- `AdnClient`: one 10 MB decompression budget per page; an NSU must be a positive integer and base64 must use
  the standard alphabet, else `AdnError` `unavailable`.
- `loadCertificate` refuses passwords over 256 characters.
- `SefinClient.findEvent(accessKey, eventType, sequence = 1)`: the registered event, or null. Use it before
  resending a cancellation or treating a refusal as final.
- `buildDps` requires `serv.comExt` for a taker abroad, a service performed abroad (`cPaisPrestacao`) or an
  export (E0330). The foreign-address rule is labeled E0242.
- `readNfseSummary`, `readNfseEventSummary` and `buildDanfseModel` throw `Error` on malformed XML or a document
  without `infNFSe`.
- `cNaoNIF` accepts 1 or 2, `comExt.mdPrestacao` 1 to 4, `comExt.movTempBens` only 1; `nDI` / `nRE` removed.
  **Breaking** only for values Sefin always rejected (E0226, E0333) or that need declaration numbers.
- `IbsCbs.indDest` accepts only `0`. **Breaking** for inputs passing `1`, which produced an invalid note anyway.
- MIT license.
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
