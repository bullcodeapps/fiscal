# Errors

Branch on the error class and its `code` / `kind`, never on message text.

## CertificateError (`loadCertificate`)

`import { CertificateError } from "@bullcode/fiscal"`. `error.message` is Portuguese and safe to show to the owner.

| `code` | Cause | Fix |
| --- | --- | --- |
| `unreadable` | Wrong password, corrupt file, not PKCS#12, or a KDF iteration count above 200,000 | Ask for the `.pfx` and its password again |
| `missing_key` | The file has the certificate but no private key | Export the full A1 certificate (`.pfx` with key) |
| `missing_cnpj` | The certificate has no ICP-Brasil CNPJ (OID 2.16.76.1.3.3), for example an e-CPF | Use the company's e-CNPJ A1 |

## Error (`buildDps`)

Thrown before any network call. The prefix names the DPS field or group, so an app can route it to the right form.

| Message | Fix |
| --- | --- |
| `cLocEmi: must be the 7-digit IBGE code` | Use `findMunicipalityCode(city, uf)` |
| `prest: CNPJ must be 14 digits` | Digits only, no mask. Use `certificate.cnpj` |
| `serie: must be 1 to 5 digits` | For example `"00001"` |
| `nDPS: must be 1 to 15 digits, not starting with 0` | `String(n)` of a positive integer from your counter |
| `serv: exactly one of cLocPrestacao or cPaisPrestacao` | Set exactly one of `serv.cLocPrestacao` / `serv.cPaisPrestacao` |
| `toma: a taker identified by NIF or cNaoNIF requires a foreign address in end (E0223)` | Give the foreign taker a `ForeignAddress` (`cPais`, `cEndPost`, `xCidade`, `xEstProvReg`, ...) |
| `toma: a foreign address in end requires the taker to be identified by NIF or cNaoNIF` | Use `NIF` or `cNaoNIF` instead of `CNPJ` / `CPF` |
| `serv: tribISSQN 3 (export of services) requires comExt (E0330)` | Add `serv.comExt` |
| `valores: tribISSQN 3 (export of services) requires cPaisResult (E0590)` | Add `valores.cPaisResult` (usually the taker's country) |
| `serv: comExt requires a taker abroad (NIF or cNaoNIF), not a CNPJ or CPF` | Remove `comExt`, or identify the taker by `NIF` / `cNaoNIF` |

## RangeError (`buildCancellation`)

| Message | Fix |
| --- | --- |
| `accessKey must be the 50-digit chave de acesso` | Pass `IssuedNfse.accessKey` as stored |
| `authorCnpj must be 14 digits` | Use `certificate.cnpj` |
| `A justificativa do cancelamento deve ter entre 15 e 255 caracteres.` | `description` must have 15 to 255 characters after trimming |

## SefinError (`SefinClient`)

`import { SefinError } from "@bullcode/fiscal/nfse"`. Fields: `kind`, `messages: { code, description, complement? }[]`,
`httpStatus?: number`.

| Condition | Meaning | Fix |
| --- | --- | --- |
| `kind: "rejected"` | Sefin answered 4xx with error messages. Nothing was issued (or, for events, registered). | Show `messages`, fix the data, build and sign again |
| `kind: "unavailable"`, `httpStatus` 401 or 403 | Sefin refused the TLS client certificate. The request was not processed. | Check the certificate (expired, revoked, wrong CNPJ, not enabled for NFS-e). The DPS number is still unused. |
| `kind: "unavailable"`, `httpStatus` undefined | Timeout or network failure. No answer arrived. | Treat the DPS as possibly authorized. Reconcile with `findAccessKeyByDpsId` before resending. |
| `kind: "unavailable"`, other `httpStatus` | 5xx, or an answer the client could not read | Same as above |

Per method:

| Method | `rejected` | `unavailable` |
| --- | --- | --- |
| `emit` | DPS refused | Note may exist: reconcile |
| `registerEvent` | Event refused (already cancelled, deadline passed, ...) | Safe to retry: Sefin rejects a duplicate event |
| `findAccessKeyByDpsId` | never (404 returns `null`) | Retry later |
| `getNfseXml` | 404: no note with this key in this environment | Retry later |

Common Sefin codes are listed in the Anexo of the NFS-e Nacional documentation. Examples the library already
prevents locally: E0223, E0330, E0590. Sefin also requires `toma.end` (E0239) and `serv.cNBS` (E0322) whenever
the DPS has `IBSCBS`.

## AdnError (`AdnClient.fetchDocuments`)

`import { AdnError } from "@bullcode/fiscal/nfse"`. Fields: `kind`, `messages: { code, description }[]`, `httpStatus?`.

| `kind` | Cause | Fix |
| --- | --- | --- |
| `rate_limited` | HTTP 429 | Stop and resume on the next scheduled run |
| `rejected` | The ADN refused the query (for example the certificate is not from the queried CNPJ's root) | Check `cnpj` and the certificate |
| `unavailable` | Timeout, network error, 5xx or an unknown body | Retry later from the same `lastNsu` |
