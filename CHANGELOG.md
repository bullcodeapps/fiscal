# Changelog

Install a version with `pnpm add github:bullcodeapps/fiscal#<tag>`.

## v0.3.3 (2026-11-12)

- Docs that ship in the package (`docs/`): integration guide with a reference implementation, `DpsInput`
  reference, error reference. AGENTS.md, an Agent Skill and TSDoc on the main entry points.
- `docs/codes.md`: where to look up each tax code, municipality adhesion, common Sefin rejection codes.
- Alphanumeric CNPJ (`[0-9A-Z]{14}`) in `loadCertificate`, `buildDps`, `buildCancellation` and `AdnClient`. Only
  produção restrita (NT 009) accepts it today; the produção schema in force is digits only.
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
- Event answers are verified: `registerEvent` and `findEvent` return only well-formed event XML for the same
  access key and event type, and `findEvent` returns null only for Sefin's JSON 404. Malformed NFS-e XML from
  `emit` / `getNfseXml` is `unavailable`. `registerEvent` throws if given anything but a `pedRegEvento`.
- Every access key is bound to the XML it names: `emit`, `getNfseXml` and the ADN require a valid chave equal
  to the note's own `infNFSe` Id, and `findAccessKeyByDpsId` validates the key format. `findEvent` returns null
  only for Sefin's error JSON and requires the registered `infEvento` with the requested sequence. Otherwise
  `unavailable`.
- `AdnClient`: a page entry that is not an object, a document without `TipoDocumento`, a page without a
  `LoteDFe` array, NSUs not strictly increasing or not plain integers, or invalid UTF-8 is `unavailable`.
  `doc.accessKey` of a note or event comes from its XML. An `EVENTO` must be a registered event (not a bare
  request) whose key matches the envelope, else `unavailable`.
- `buildDps` requires exactly one taker identity (`CNPJ`, `CPF`, `NIF` or `cNaoNIF`).
- `tribISSQN` 2 (immunity) and `tpRetISSQN` 3 (withheld by an intermediary) removed: the DPS has no
  `tpImunidade` or intermediary group, and `buildDps` throws for them. **Breaking** for inputs using them.
  `docs/dps-input.md` lists the supported scenarios.
- Access keys and events are read with the XML parser: a key in a comment, an event request outside
  `infEvento`, malformed ADN XML or a malformed ADN envelope key is `unavailable`.
- DANFSe shows `cPaisPrestacao` / `cPaisResult` instead of BR for services abroad and exports.
- `renderDanfse(nfseXml, { situation })` and `buildDanfseModel`: "CANCELADA" or "SUBSTITUÍDA" watermark
  (NT 008 2.5). The header shows `Município: name / UF`, and no municipality for national code item 99. The
  complementary information lists `Cod. Obra`, `Insc. Imob.` and `Cod. Evt.`. cStat 107 reads "NFS-e MEI".
- `readNfseEventSummary` reads only the registered request (`evento/infEvento/pedRegEvento/infPedReg`); a bare
  request returns code null.
- `buildCancellation` counts the justification in characters, not UTF-16 units.
- `findAccessKeyByDpsId` returns null only for Sefin's 404 error JSON; a gateway 404 is `unavailable`.
- `registerEvent` throws if `accessKey` is not the `chNFSe` of the signed request.
- `readNfseSummary` returns `dpsId`, so an import can recognize the app's own notes before their key is known.
- `findEvent` returns null only for a 404 whose `erro` is an object; the ADN empty queue only on HTTP 200 or 404.
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
