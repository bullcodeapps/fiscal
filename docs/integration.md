# Integration guide

This guide takes an app from zero to issuing, storing, cancelling and importing NFS-e Nacional notes.
Follow it in order. Every rule here comes from a failure seen against Sefin.

## 1. What the library does and what the app does

The library builds and signs XML, talks to Sefin and the ADN over mTLS, and renders the DANFSe PDF.
It has no state.

The app owns:

- the A1 certificate file and its password (store both encrypted)
- the DPS numbering (`serie` + `nDPS`)
- one row per note, with its state, as described in step 4
- the retry and reconciliation loop

Before writing code, confirm that the issuing municipality accepts notes from the national emitters
(see "Municipality adhesion" in [codes.md](./codes.md)). Otherwise Sefin rejects every DPS with E0037 to E0039.

## 2. Load the certificate

```ts
import { readFileSync } from "node:fs";
import { loadCertificate, CertificateError } from "@bullcode/fiscal";

const certificate = loadCertificate(readFileSync("cert.pfx"), password);
// certificate.cnpj      "11222333000181" (14 digits, read from the ICP-Brasil OID)
// certificate.validTo   Date; warn the user before it expires
```

`loadCertificate` throws `CertificateError` with `code`:

| code | Cause | Fix |
| --- | --- | --- |
| `unreadable` | Wrong password, corrupt file, or KDF iteration count above 200,000 | Ask for the file and password again |
| `missing_key` | The file has no private key | Export the full A1 `.pfx` again |
| `missing_cnpj` | Not an ICP-Brasil e-CNPJ (for example an e-CPF) | Use the company's e-CNPJ A1 |

`error.message` is in Portuguese and safe to show to the certificate owner.
Use `certificate.cnpj` as `prest.CNPJ`. Sefin refuses a DPS whose provider is not the certificate's CNPJ.

## 3. Choose the environment

| `environment` | tpAmb | Effect |
| --- | --- | --- |
| `"restricted"` | 2 | Produção restrita. Real Sefin, no fiscal effect. The DANFSe says "SEM VALIDADE JURÍDICA". |
| `"production"` | 1 | Real notes with fiscal effect. |

Develop and test against `"restricted"` with the real certificate. Keep the environment on each note row,
because a note can only be queried and cancelled in the environment that issued it.
`buildDps` emits the XML layout that each environment validates, so pass the same value everywhere.

## 4. Store one row per note

Create the row before you talk to Sefin. Suggested columns:

| Column | Set when |
| --- | --- |
| `environment`, `serie`, `nDPS` | The row is created. `nDPS` comes from an atomic counter per (`environment`, `serie`). |
| `dpsId`, `signedDpsXml` | After `buildDps` + `signDps`, before the first send |
| `sentAt` | Right before each `client.emit` |
| `accessKey` | As soon as Sefin returns it. Never cleared. |
| `nfseXml` | After authorization (from `emit` or `getNfseXml`) |
| `status` | `draft`, `issuing`, `authorized`, `rejected`, `unavailable`, `cancelled` |
| `messages` | Sefin's `{ code, description }[]` from the last failure |

Rules:

- `nDPS` is a positive integer as a string, unique per CNPJ, `serie` and environment. Never reuse a number
  that Sefin may have authorized.
- `serie` is 5 digits. `00001` to `49999` is the range for the taxpayer's own software.
- Allow only one attempt per row at a time (row lock or compare-and-set on `status`).

## 5. Build, sign and emit

```ts
import { buildDps, signDps, SefinClient, SefinError } from "@bullcode/fiscal/nfse";

const dps = buildDps(input); // DpsInput, see dps-input.md. Throws Error on invalid input.
const signedDpsXml = signDps(dps.xml, certificate);
await save({ dpsId: dps.id, signedDpsXml, sentAt: null });

const client = new SefinClient({ environment: input.environment, certificate });
await save({ sentAt: new Date() });
const issued = await client.emit(signedDpsXml);
await save({ accessKey: issued.accessKey }); // save the key first, alone
await save({ nfseXml: issued.nfseXml, status: "authorized" });
```

`emit` is synchronous: a resolved promise means the note exists.
`issued.alerts` holds non-blocking Sefin warnings. Log them.

## 6. Handle every outcome

`emit` throws `SefinError`. Branch on `error.kind` and `error.httpStatus`, never on the message text.

| Condition | Meaning | What to do |
| --- | --- | --- |
| `kind === "rejected"` | Sefin refused the DPS. No note exists. `error.messages` says why (`E0xxx` codes). | Set `rejected`, show the messages, let the user fix the data, then build and sign again. |
| `kind === "unavailable"` and `httpStatus` is 401 or 403 | Sefin refused the TLS client certificate. The DPS was not processed. | Set `rejected` with a certificate message and clear `sentAt`. The number is still unused. |
| `kind === "unavailable"` (any other case) | Timeout, network error or 5xx. The note MAY exist. | Set `unavailable`. Do not build a new DPS. Reconcile (step 7). |
| Any other exception after `emit` was called | Same as `unavailable` | Same as `unavailable` |

`buildDps`, `signDps` and `buildCancellation` throw plain `Error` / `RangeError` before any network call.
`buildDps` messages start with the DPS field or group (`cLocEmi:`, `prest:`, `serie:`, `nDPS:`, `toma:`, `serv:`, `valores:`) and quote the Sefin code they prevent, when there is one.
See [errors.md](./errors.md) for the full list.

## 7. Reconcile after `unavailable`

Run this before any new send of a row that has `sentAt` set and no `accessKey`:

```ts
const accessKey = await client.findAccessKeyByDpsId(row.dpsId);
if (accessKey) {
  await save({ accessKey });
  const nfseXml = await client.getNfseXml(accessKey);
  await save({ nfseXml, status: "authorized" });
} else {
  // Sefin never authorized it: send the SAME signedDpsXml again.
  await save({ sentAt: new Date() });
  const issued = await client.emit(row.signedDpsXml);
  // ...as in step 5
}
```

If `findAccessKeyByDpsId` itself throws, keep the row `unavailable` and try again later.
Never allocate a new `nDPS` for a row that Sefin may hold: that creates a duplicate note.

## 8. Complete reference implementation

Storage-agnostic. Replace `Store` with your database. This is the loop the steps above describe.

```ts
import type { Certificate, Environment } from "@bullcode/fiscal";
import {
  buildDps,
  readNfseSummary,
  SefinClient,
  SefinError,
  signDps,
  type DpsInput,
  type SefinMessage,
} from "@bullcode/fiscal/nfse";

type Status = "draft" | "issuing" | "authorized" | "rejected" | "unavailable";

interface NoteRow {
  id: string;
  environment: Environment;
  status: Status;
  nDPS: string;
  dpsId: string | null;
  signedDpsXml: string | null;
  sentAt: Date | null;
  accessKey: string | null;
  nfseXml: string | null;
  number: string | null;
  messages: SefinMessage[] | null;
}

interface Store {
  load(id: string): Promise<NoteRow>;
  /**
   * Compare-and-set to "issuing": true only for the caller that won. Also takes a row stuck in "issuing"
   * for over 10 minutes, so a crashed attempt never blocks the note.
   */
  claim(id: string, from: Status): Promise<boolean>;
  patch(id: string, values: Partial<NoteRow>): Promise<void>;
  nextNumber(): Promise<string>;
}

const isCertificateRefusal = (e: unknown) =>
  e instanceof SefinError && (e.httpStatus === 401 || e.httpStatus === 403);

export async function issue(
  store: Store,
  id: string,
  certificate: Certificate,
  /** Builds the DpsInput from current app data for a given nDPS. */
  inputFor: (nDPS: string) => DpsInput,
): Promise<Status> {
  const row = await store.load(id);
  if (row.status === "authorized") return "authorized";
  if (!(await store.claim(id, row.status))) return "issuing";

  const client = new SefinClient({ environment: row.environment, certificate });
  let accessKey = row.accessKey;
  let nfseXml: string | null = null;

  try {
    if (!accessKey && row.sentAt && row.dpsId) {
      accessKey = await client.findAccessKeyByDpsId(row.dpsId);
    }
  } catch (e) {
    await store.patch(id, { status: "unavailable" });
    return "unavailable";
  }

  if (!accessKey) {
    let signed = row.signedDpsXml;
    if (!signed || row.status === "rejected") {
      // A rejected DPS created nothing, so the data is rebuilt from the corrected input.
      const nDPS = row.status === "rejected" && row.sentAt ? await store.nextNumber() : row.nDPS;
      let dps;
      try {
        dps = buildDps(inputFor(nDPS));
      } catch (e) {
        await store.patch(id, { status: "rejected", messages: [{ code: "LOCAL", description: String(e) }] });
        return "rejected";
      }
      signed = signDps(dps.xml, certificate);
      await store.patch(id, { nDPS, dpsId: dps.id, signedDpsXml: signed, sentAt: null, messages: null });
    }

    await store.patch(id, { sentAt: new Date() });
    try {
      const issued = await client.emit(signed);
      accessKey = issued.accessKey;
      nfseXml = issued.nfseXml;
    } catch (e) {
      if (isCertificateRefusal(e)) {
        await store.patch(id, { status: "rejected", sentAt: null, messages: [{ code: "CERTIFICATE_REFUSED", description: `HTTP ${(e as SefinError).httpStatus}` }] });
        return "rejected";
      }
      if (e instanceof SefinError && e.kind === "rejected") {
        await store.patch(id, { status: "rejected", messages: e.messages });
        return "rejected";
      }
      await store.patch(id, { status: "unavailable" });
      return "unavailable";
    }
    await store.patch(id, { accessKey });
  }

  try {
    nfseXml ??= await client.getNfseXml(accessKey);
  } catch {
    // The key is stored, so the next call fetches the XML and never sends again.
    await store.patch(id, { status: "unavailable" });
    return "unavailable";
  }
  await store.patch(id, { status: "authorized", nfseXml, number: readNfseSummary(nfseXml).number, messages: null });
  return "authorized";
}
```

Call `issue` again for any row in `unavailable` (a cron job or a retry button). It is safe to call at any time.

## 9. Render the DANFSe

```ts
import { renderDanfse, buildDanfseModel } from "@bullcode/fiscal/nfse";

const pdf: Buffer = await renderDanfse(nfseXml); // DANFSe v2.0 (NT 008), A4, with QR code
```

Render from the stored `nfseXml` at any time. The PDF is derived only from the XML, so store the XML and
re-render on demand. `buildDanfseModel(nfseXml)` returns the same content as data, for a custom layout.

## 10. Read a note

```ts
import { readNfseSummary } from "@bullcode/fiscal/nfse";

const summary = readNfseSummary(nfseXml);
// accessKey, number (nNFSe), providerDocument, takerDocument, takerName, takerNif,
// serviceValueCents, issqnCents, issqnInSimples, competenceDate, issuedAt, description
```

Use it to show the note and to confirm that a note found by reconciliation is the one you meant to issue.

## 11. Cancel

```ts
import { buildCancellation } from "@bullcode/fiscal/nfse";

const eventXml = buildCancellation(
  {
    environment: row.environment,
    accessKey: row.accessKey,
    authorCnpj: certificate.cnpj,
    reason: 1, // 1 Erro na emissão, 2 Serviço não prestado, 9 Outros
    description: "Valor informado incorretamente", // 15 to 255 characters, else RangeError
    verAplic: "my-app-1.0",
    at: new Date(),
  },
  certificate,
);
const registered = await client.registerEvent(row.accessKey, eventXml);
```

`registerEvent` throws `SefinError`. `rejected` means Sefin refused the cancellation: the note is already
cancelled, or a municipal limit applies (deadline, default 730 days; value; taxes already paid). See the event
codes in [codes.md](./codes.md). After the deadline, only the taxpayer can ask for análise fiscal in the
national portal. `unavailable` is safe to retry: Sefin rejects a duplicate event.
Store `registered` (the event XML Sefin signed back) and set the row to `cancelled`.

## 12. Import notes from the ADN

The ADN distributes every document where the CNPJ is provider, taker or intermediary, including notes
issued outside your app and cancellation events.

```ts
import { AdnClient, AdnError, readNfseSummary, readNfseEventSummary } from "@bullcode/fiscal/nfse";

const adn = new AdnClient({ environment: "production", cnpj: certificate.cnpj, certificate });
let lastNsu = await loadLastNsu(); // persist it; start at 0
for (;;) {
  const page = await adn.fetchDocuments(lastNsu); // up to 50, NSU order
  if (page.length === 0) break;
  for (const doc of page) {
    if (doc.type === "NFSE") upsertNote(readNfseSummary(doc.xml), doc.xml);
    else applyEvent(readNfseEventSummary(doc.xml)); // code "101101" is a cancellation
    lastNsu = doc.nsu;
  }
  await saveLastNsu(lastNsu);
}
```

`AdnError.kind`: `rate_limited` (HTTP 429, stop and resume later), `rejected` (the certificate may not query
this CNPJ), `unavailable` (retry later). Run the import on a schedule, not in a tight loop.

## 13. Test against produção restrita

Produção restrita issues real notes with no fiscal effect. The repository has scripts that do one full round:

```sh
pnpm build
node scripts/smoke-restricted.mjs cert.pfx password.txt          # domestic taker
node scripts/smoke-export-restricted.mjs cert.pfx password.txt   # foreign taker
node scripts/cancel-restricted.mjs cert.pfx password.txt <accessKey>
```

For unit tests in your app, inject a fake with the `SefinClient` methods you use
(`Pick<SefinClient, "emit" | "findAccessKeyByDpsId" | "getNfseXml">`) and throw `new SefinError(kind, messages, httpStatus)`
to drive each branch of step 6.

## Checklist

- [ ] Certificate and password stored encrypted, `validTo` monitored
- [ ] `prest.CNPJ` equals `certificate.cnpj`
- [ ] `nDPS` from an atomic counter per environment and `serie`
- [ ] Row created and signed DPS saved before the first `emit`
- [ ] `sentAt` saved before each `emit`, `accessKey` saved alone right after
- [ ] `rejected`, certificate refusal and `unavailable` handled as in step 6
- [ ] Reconciliation by `dpsId` before any resend
- [ ] One attempt per row at a time
- [ ] `nfseXml` stored; DANFSe rendered from it
- [ ] Environment stored per note and used for queries and cancellation
