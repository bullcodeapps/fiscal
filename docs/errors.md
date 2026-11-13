# Errors

Branch on the error class and its `code` / `kind`, never on message text. This page lists every error the
library defines.

## Error (parsers)

`readNfseSummary`, `readNfseEventSummary` and `buildDanfseModel` throw a plain `Error` with a message starting
`Malformed XML:` for XML that does not parse, and `Not an NFS-e: infNFSe is missing` for a document that is not
an NFS-e. Do not advance an import cursor past such a document: alert and retry later.

## CertificateError (`loadCertificate`)

`import { CertificateError } from "@bullcode/fiscal"`. `error.message` is Portuguese and safe to show to the owner.

| `code` | Cause | Fix |
| --- | --- | --- |
| `unreadable` | Wrong password, password over 256 characters, corrupt file, not PKCS#12, file over 64 KB, or key-derivation iterations above 300,000 in total | Ask for the `.pfx` and its password again |
| `missing_key` | The file has the certificate but no private key | Export the full A1 certificate (`.pfx` with key) |
| `missing_cnpj` | The certificate has no ICP-Brasil CNPJ (OID 2.16.76.1.3.3), for example an e-CPF | Use the company's e-CNPJ A1 |

`loadCertificate` is synchronous. The costliest file it accepts takes about 0.3 s of CPU, so rate-limit uploads
or call it in a worker thread.

## Error (`buildDps`)

Thrown before any network call. The prefix names the DPS field or group, so an app can route it to the right form.

| Message | Fix |
| --- | --- |
| `cLocEmi: must be the 7-digit IBGE code` | Use `findMunicipalityCode(city, uf)` |
| `prest: CNPJ must be 14 digits or uppercase letters` | No mask (alphanumeric CNPJ allowed). Use `certificate.cnpj` |
| `serie: must be 1 to 5 digits` | For example `"00001"` |
| `nDPS: must be 1 to 15 digits, not starting with 0` | `String(n)` of a positive integer from your counter |
| `serv: exactly one of cLocPrestacao or cPaisPrestacao` | Set exactly one of `serv.cLocPrestacao` / `serv.cPaisPrestacao` |
| `toma: a taker identified by NIF or cNaoNIF requires a foreign address in end (E0242)` | Give the foreign taker a `ForeignAddress` (`cPais`, `cEndPost`, `xCidade`, `xEstProvReg`, ...) |
| `toma: a foreign address in end requires the taker to be identified by NIF or cNaoNIF (E0223)` | Use `NIF` or `cNaoNIF` instead of `CNPJ` / `CPF` |
| `serv: comExt is required for a taker abroad, a service abroad or an export (E0330)` | Add `serv.comExt` |
| `valores: tribISSQN 3 (export of services) requires cPaisResult (E0590)` | Add `valores.cPaisResult` (usually the taker's country) |

## RangeError (`buildCancellation`)

| Message | Fix |
| --- | --- |
| `accessKey must be the 50-character chave de acesso` | Pass `IssuedNfse.accessKey` as stored |
| `authorCnpj must be 14 digits or uppercase letters` | Use `certificate.cnpj` |
| `A justificativa do cancelamento deve ter entre 15 e 255 caracteres.` | `description` must have 15 to 255 characters after trimming |

## SefinError (`SefinClient`)

`import { SefinError } from "@bullcode/fiscal/nfse"`. Fields: `kind`, `messages: { code, description, complement? }[]`,
`httpStatus?: number`.

| Condition | Meaning | Fix |
| --- | --- | --- |
| Either kind, `httpStatus` 401 or 403 | Sefin refused the TLS client certificate. The request was not processed. | Check the certificate (expired, revoked, wrong CNPJ, not enabled for NFS-e). The DPS number is still unused. |
| `kind: "rejected"`, a message has code `E0014` | Sefin already holds a note for this `serie` + `nDPS` | Not a rejection: reconcile with `findAccessKeyByDpsId` and check it with `isNfseOfDps` |
| `kind: "rejected"` (any other case) | Sefin answered 4xx with error messages. Nothing was issued (or, for events, registered). | Show `messages`, fix the data, build and sign again with the same `nDPS` |
| `kind: "unavailable"`, `httpStatus` undefined | Timeout or network failure. No answer arrived. | Treat the DPS as possibly authorized. Reconcile with `findAccessKeyByDpsId` before resending. |
| `kind: "unavailable"`, other `httpStatus` | 5xx, or an answer the client could not read: unknown body, malformed gzip or base64, body or decompressed XML over 10 MB | Same as above |

`timeoutMs` (default 30000) is an inactivity timeout: the request fails when the connection stays idle that long.
It is not a total deadline.

Per method:

| Method | `rejected` | `unavailable` |
| --- | --- | --- |
| `emit` | DPS refused | Note may exist: reconcile |
| `registerEvent` | Event refused (already cancelled, deadline passed, ...). It is final only when `findEvent` returns null: the refusal can be the duplicate of an event that went through | Look up with `findEvent` before resending |
| `findEvent` | 4xx with messages: retry later, never read it as "no event" | Retry later. Only `null` (HTTP 404) means the note has no such event |
| `findAccessKeyByDpsId` | never (404 returns `null`) | Retry later |
| `getNfseXml` | 404: no note with this key in this environment. For a key you already stored (just emitted or reconciled), treat it as transient and retry | Retry later |

Common Sefin codes are listed in the Anexo of the NFS-e Nacional documentation. Examples the library already
prevents locally: E0223, E0242, E0330, E0590. Sefin also requires `serv.cNBS` (E0322) whenever
the DPS has `IBSCBS`, and the taker's CNPJ/CPF and national address when the IBS/CBS incidence falls on that
address (E0239, depends on `cIndOp`).

## AdnError (`AdnClient.fetchDocuments`)

`import { AdnError } from "@bullcode/fiscal/nfse"`. Fields: `kind`, `messages: { code, description }[]`, `httpStatus?`.

| `kind` | Cause | Fix |
| --- | --- | --- |
| `rate_limited` | HTTP 429 | Stop and resume on the next scheduled run |
| `rejected` | The ADN refused the query (for example the certificate is not from the queried CNPJ's root) | Check `cnpj` and the certificate |
| `unavailable` | Timeout, network error, 5xx, an unknown body, a body over 10 MB, a page whose documents decompress to more than 10 MB in total, base64 outside the standard alphabet, malformed gzip, or an NSU that is not a positive integer | Retry later from the same `lastNsu` |
