# Changelog

Install with `pnpm add @bullcode/fiscal`.

## v0.3.5 (2026-11-13)

- pdfkit 0.20.2. The DANFSe is pixel-identical to 0.3.4, also inside a bundled Next.js app.
- Built with tsup 9: the same JavaScript, and type files that use `export type`.
- CI checks the package types for node10, CommonJS, ESM and bundlers.

## v0.3.4 (2026-11-13)

- Published on npm as `@bullcode/fiscal`. `dist` is no longer committed, so install from npm. Git tags up to
  v0.3.3 keep their committed `dist`.
- Releases publish from CI with npm provenance. CI runs on Node 20, 22 and 24.

## v0.3.3 (2026-11-13)

First public release. MIT license.

Docs and agents:

- `docs/` ships in the package: integration guide with reference implementations for issuance, cancellation and
  ADN import, `DpsInput` reference, every error, and where to find each tax code (`codes.md`).
- AGENTS.md, an Agent Skill (`skills/nfse-integration`) and TSDoc on the main entry points.

New:

- `isNfseOfDps(nfseXml, signedDpsXml)`: true when a note embeds exactly this signed DPS.
- `SefinClient.findEvent(accessKey, eventType, sequence = 1)`: the registered event, or null.
- `renderDanfse(nfseXml, { situation })`: "CANCELADA" / "SUBSTITUÍDA" watermark (NT 008). The DANFSe also
  follows NT 008 for the header, construction and event codes, MEI status, the produção layout and services abroad.
- `readNfseSummary` returns `dpsId`.
- Alphanumeric CNPJ (12 digits or uppercase letters plus 2 numeric check digits) everywhere. Only produção restrita accepts it today.

Breaking (only for inputs Sefin rejected or the DPS cannot describe):

- `buildDps` validates `cLocEmi`, `prest.CNPJ`, `serie`, `nDPS` and one taker identity, and enforces E0223, E0242,
  E0330 and E0590. `buildCancellation` validates `accessKey`, `authorCnpj` and counts characters correctly.
- Removed: `opSimpNac` 4 (not in either XSD in force), `tribISSQN` 2, `tpRetISSQN` 3, `IbsCbs.indDest` 1, `cNaoNIF` 0, `movTempBens` 2 and 3, `nDI` / `nRE`.
- `readNfseSummary`, `readNfseEventSummary` and `buildDanfseModel` throw on malformed XML.
  `readNfseEventSummary` reads only a registered event; a bare request returns code null.

Safer answers from Sefin and the ADN (`unavailable` instead of a wrong result):

- Every access key must be a valid chave equal to the note's own `infNFSe` Id; events must be the registered
  event for the requested key, type and sequence. Keys and events are read with the XML parser.
- `findEvent` and `findAccessKeyByDpsId` return null only for Sefin's 404 error JSON.
- ADN pages: `LoteDFe` array, NSUs positive plain integers in increasing order, documents of a known type
  well-formed and keyed like their envelope.
- 10 MB limits on bodies and decompressed XML; canonical base64 and strict UTF-8 in every answer.
- An access key must have the chave structure, and a CNPJ 12 alphanumeric characters plus 2 numeric check
  digits. An ADN page holds at most 50 documents and an event exactly one event group. `isNfseOfDps` reads the
  embedded DPS signature with the XML parser. An ADN `REJEICAO` on a 5xx is
  `unavailable`.

Security:

- `loadCertificate` refuses files over 64 KB, passwords over 256 characters and more than 300,000 key-derivation
  iterations. See SECURITY.md.
- node-forge 1.4.3 and fast-xml-parser 5.12.0 (advisories). pnpm 10 pinned.

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
