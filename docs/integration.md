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
// certificate.cnpj      "11222333000181" (14 digits or uppercase letters, read from the ICP-Brasil OID)
// certificate.validTo   Date; warn the user before it expires
```

`loadCertificate` throws `CertificateError` with `code`:

| code | Cause | Fix |
| --- | --- | --- |
| `unreadable` | Wrong password, corrupt file, file over 64 KB, or key-derivation iterations above 300,000 in total | Ask for the file and password again |
| `missing_key` | The file has no private key | Export the full A1 `.pfx` again |
| `missing_cnpj` | Not an ICP-Brasil e-CNPJ (for example an e-CPF) | Use the company's e-CNPJ A1 |

`error.message` is in Portuguese and safe to show to the certificate owner.
Use `certificate.cnpj` as `prest.CNPJ`. Sefin refuses a DPS whose provider is not the certificate's CNPJ.
An alphanumeric CNPJ is accepted only by produção restrita (NT 009 schema) today: the produção schema in force is
digits only, so such a provider cannot issue in produção until NT 009 is deployed there.

Security: `loadCertificate` only extracts data. It does not validate the ICP-Brasil chain, so `certificate.cnpj`
is not proof that the uploader owns the company. Never log the certificate, its password or `privateKeyPem`.
It is synchronous, and its iteration cap only sees the unencrypted layers of the file: parse untrusted uploads in
a worker thread with a time limit, and rate-limit them.

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
| `environment`, `providerCnpj`, `serie`, `nDPS` | The row is created. `nDPS` comes from an atomic counter per (`environment`, `providerCnpj`, `serie`) and never changes. |
| `dpsId`, `signedDpsXml` | After `buildDps` + `signDps`, before the first send. Cleared when Sefin rejects the DPS. |
| `sentAt` | Right before each `client.emit` |
| `accessKey` | As soon as Sefin returns it. Never cleared. |
| `nfseXml` | After authorization (from `emit` or `getNfseXml`) |
| `status` | `draft`, `issuing`, `authorized`, `rejected`, `unavailable`, `conflict`, `cancelling`, `cancelled` |
| `lease` | Set by each attempt that claims the row (steps 8 and 11) |
| `cancelEventXml` | The signed cancellation request, stored when the user asks to cancel (step 11) |
| `cancelSentAt` | Right before each `registerEvent` |
| `cancellationXml` | The registered event: from `registerEvent`, `findEvent` or the ADN import |
| `messages` | Sefin's `{ code, description }[]` from the last failure |

Rules:

- `nDPS` is a positive integer as a string, unique per CNPJ, `serie` and environment. A row keeps its number
  for life: a rejected DPS created nothing, so the corrected DPS reuses it. Never give a row a new number.
- `serie` is 5 digits. `00001` to `49999` is the range for the taxpayer's own software.
- Allow only one attempt per row at a time, and fence stale attempts with a lease (step 8).
- `signedDpsXml` is the immutable snapshot of what the row sends. Once it is stored, do not change what the row
  will send. Only a rejected row is rebuilt from current app data.

Security: `signedDpsXml`, `nfseXml` and event XML embed the public certificate, which carries the legal
representative's CPF and birth date, plus the taker's data. Store them with the same care as customer data.

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
| `kind === "rejected"`, a message has code `E0014` | Sefin already holds a note for this `serie` + `nDPS`. | Not a rejection: set `unavailable` and reconcile (step 7). |
| `kind === "rejected"` (any other code) | Sefin refused the DPS. No note exists. `error.messages` says why (`E0xxx` codes, see [codes.md](./codes.md)). | Set `rejected`, clear `dpsId`, `signedDpsXml` and `sentAt`, show the messages. After the fix, build and sign again with the same `nDPS`. |
| Either kind and `httpStatus` is 401 or 403 | Sefin refused the TLS client certificate (expired, revoked, not an e-CNPJ). The DPS was not processed. | Same as a rejection, with a certificate message. |
| `kind === "unavailable"` (any other case) | Timeout, network error, 5xx, or an oversized or malformed answer. The note MAY exist. | Set `unavailable`. Do not build a new DPS. Reconcile (step 7). |
| Any other exception after `emit` was called | Same as `unavailable` | Same as `unavailable` |

`buildDps`, `signDps` and `buildCancellation` throw plain `Error` / `RangeError` before any network call.
`buildDps` messages start with the DPS field or group (`cLocEmi:`, `prest:`, `serie:`, `nDPS:`, `toma:`, `serv:`, `valores:`) and quote the Sefin code they prevent, when there is one.
See [errors.md](./errors.md) for the full list.

## 7. Reconcile after `unavailable`

Run this before any new send of a row that has `sentAt` set and no `accessKey`:

```ts
import { isNfseOfDps } from "@bullcode/fiscal/nfse";

const accessKey = await client.findAccessKeyByDpsId(row.dpsId);
if (accessKey) {
  await save({ accessKey });
  const nfseXml = await client.getNfseXml(accessKey);
  // The note found by DPS Id must embed exactly this signed DPS.
  await save({ nfseXml, status: isNfseOfDps(nfseXml, row.signedDpsXml) ? "authorized" : "conflict" });
} else {
  // Sefin never authorized it: send the SAME signedDpsXml again.
  await save({ sentAt: new Date() });
  const issued = await client.emit(row.signedDpsXml);
  // ...as in step 5
}
```

If `findAccessKeyByDpsId` or `getNfseXml` throws, keep the row `unavailable` and try again later. A
`getNfseXml` 404 (`rejected`) for a key you already stored is transient (the note is still propagating): never
treat a stored key as a nonexistent note.
A note found this way must be this row's note: `isNfseOfDps(nfseXml, row.signedDpsXml)` checks that it embeds
exactly the stored signed DPS (same Id and same signed digest). False means another DPS used the number (for
example a restored counter): set `conflict` and show it to a person. Never rebuild the input from current app
data to compare, and never resend with a new `nDPS`: that creates a duplicate note.

## 8. Complete reference implementation

Storage-agnostic. Implement `Store` on your database. This is the loop the steps above describe.

```ts
import type { Certificate, Environment } from "@bullcode/fiscal";
import {
  buildDps,
  isNfseOfDps,
  readNfseSummary,
  SefinClient,
  SefinError,
  signDps,
  type DpsInput,
  type SefinMessage,
} from "@bullcode/fiscal/nfse";

type Status =
  | "draft"
  | "issuing"
  | "authorized"
  | "rejected"
  | "unavailable"
  | "conflict"
  | "cancelling"
  | "cancelled";

interface NoteRow {
  id: string;
  environment: Environment;
  status: Status;
  providerCnpj: string;
  serie: string;
  /** Allocated when the row is created, from a counter per environment + provider CNPJ + serie. */
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
   * Compare-and-set to "issuing" from "draft", "rejected" or "unavailable", or from "issuing" older than
   * 10 minutes (a crashed attempt). Returns a new lease, or null when the row cannot be claimed.
   */
  claim(id: string): Promise<string | null>;
  /**
   * Writes only while the row still holds `lease`, else throws: a stale attempt never overwrites a newer one.
   * A write that sets `status` also clears the lease, so the next step (a cancellation) can claim the row at once.
   */
  patch(id: string, lease: string, values: Partial<NoteRow>): Promise<void>;
}

/** Sefin already holds a note for this serie + nDPS. */
const DUPLICATE_DPS = "E0014";

function failure(e: unknown): Partial<NoteRow> & { status: Status } {
  const refused = e instanceof SefinError && (e.httpStatus === 401 || e.httpStatus === 403);
  const rejected =
    e instanceof SefinError && e.kind === "rejected" && !e.messages.some((m) => m.code === DUPLICATE_DPS);
  if (refused || rejected) {
    // Nothing was issued: drop the DPS so the next attempt rebuilds it, with the same nDPS, from corrected data.
    const messages = refused
      ? [{ code: "CERTIFICATE_REFUSED", description: `HTTP ${(e as SefinError).httpStatus}` }]
      : (e as SefinError).messages;
    return { status: "rejected", dpsId: null, signedDpsXml: null, sentAt: null, messages };
  }
  return {
    status: "unavailable",
    messages: e instanceof SefinError ? e.messages : [{ code: "UNKNOWN", description: String(e) }],
  };
}

/** The Sefin calls `issue` makes. Pass a real `SefinClient` or a test fake. */
type IssueClient = Pick<SefinClient, "emit" | "findAccessKeyByDpsId" | "getNfseXml">;

export async function issue(
  store: Store,
  id: string,
  client: IssueClient,
  /** Signs a new DPS. Use the same certificate the client uses for mTLS. */
  certificate: Certificate,
  /** Builds a NEW DpsInput from current app data, with `nDPS: row.nDPS`. Only called when no signed DPS is stored. */
  inputFor: (row: NoteRow) => DpsInput,
): Promise<Status> {
  const lease = await store.claim(id);
  if (!lease) return (await store.load(id)).status;
  const save = (values: Partial<NoteRow>) => store.patch(id, lease, values);
  const row = await store.load(id);
  let signed = row.signedDpsXml;
  let accessKey = row.accessKey;
  let nfseXml: string | null = null;

  // 1. A previous send has an unknown outcome: ask Sefin before sending anything.
  if (!accessKey && row.sentAt && row.dpsId) {
    try {
      accessKey = await client.findAccessKeyByDpsId(row.dpsId);
    } catch {
      await save({ status: "unavailable" });
      return "unavailable";
    }
    if (accessKey) await save({ accessKey }); // persisted before fetching the XML, as on the emit path
  }

  // 2. Send. A stored signed DPS is resent as is; only a new or rejected row builds one.
  if (!accessKey) {
    if (!signed) {
      try {
        const input = inputFor(row);
        // The number was allocated with the row: a value from a form would desync the counter.
        const sameNumber = input.environment === row.environment && input.serie === row.serie && input.nDPS === row.nDPS;
        if (!sameNumber || input.prest.CNPJ !== row.providerCnpj || certificate.cnpj !== row.providerCnpj) {
          throw new Error("inputFor and the certificate must match the row's environment, provider, serie and nDPS");
        }
        const dps = buildDps(input);
        signed = signDps(dps.xml, certificate);
        await save({ dpsId: dps.id, signedDpsXml: signed, messages: null });
      } catch (e) {
        await save({ status: "rejected", messages: [{ code: "LOCAL", description: String(e) }] });
        return "rejected";
      }
    }
    await save({ sentAt: new Date() });
    try {
      const issued = await client.emit(signed);
      if (issued.alerts.length > 0) console.warn(`Sefin alerts for note ${id}`, issued.alerts);
      accessKey = issued.accessKey;
      nfseXml = issued.nfseXml;
    } catch (e) {
      const values = failure(e);
      await save(values);
      return values.status;
    }
    await save({ accessKey });
  }

  // 3. Fetch the note when the key came from reconciliation, and check that it embeds this row's signed DPS.
  try {
    nfseXml ??= await client.getNfseXml(accessKey);
  } catch {
    await save({ status: "unavailable" });
    return "unavailable";
  }
  if (!signed || !isNfseOfDps(nfseXml, signed)) {
    await save({ status: "conflict", nfseXml, messages: [{ code: "CONFLICT", description: "Sefin holds another note for this DPS" }] });
    return "conflict";
  }
  await save({ status: "authorized", nfseXml, number: readNfseSummary(nfseXml).number, messages: null });
  return "authorized";
}
```

Build one `SefinClient` per (environment, certificate), reuse it across calls, and pass the one whose environment
is the row's.

The stale-claim window (10 minutes here) must be longer than the slowest Sefin call. `timeoutMs` is an idle
timeout, so a response that trickles in can outlast it: keep the window well above `timeoutMs`, or renew the
lease before each Sefin call.

Call `issue` again for any row in `unavailable` or stuck in `issuing` (a cron job or a retry button), and after
the user fixes a `rejected` row. It is safe to call at any time and from several workers. A `conflict` needs a person.

## 9. Render the DANFSe

```ts
import { renderDanfse, buildDanfseModel } from "@bullcode/fiscal/nfse";

const pdf: Buffer = await renderDanfse(nfseXml); // DANFSe v2.0 (NT 008), A4, with QR code
const cancelledPdf = await renderDanfse(nfseXml, { situation: "cancelled" }); // "CANCELADA" watermark
```

Render from the stored `nfseXml` at any time and re-render on demand. The XML does not say whether the note was
later cancelled or replaced, so pass `situation` from the row: `"cancelled"` when it is `cancelled` (NT 008
requires the watermark), `"substituted"` when another note replaced it (event 105102). `buildDanfseModel(nfseXml,
options)` returns the same content as data, for a custom layout.

## 10. Read a note

```ts
import { readNfseSummary } from "@bullcode/fiscal/nfse";

const summary = readNfseSummary(nfseXml);
// accessKey, number (nNFSe), providerDocument, takerDocument, takerName, takerNif,
// serviceValueCents, issqnCents, issqnInSimples, competenceDate, issuedAt, description
```

Use it to show the note. To check that a note found by reconciliation is this row's note, use `isNfseOfDps` (step 7).

## 11. Cancel

A cancellation can end with an unknown outcome, so it follows the issuance pattern: validate, persist the
signed request, send under a lease, and look the event up with `findEvent` before resending or giving up.

At request time, build the signed event first. `buildCancellation` throws `RangeError` on a bad description
(15 to 255 characters) or key: answer the user and change nothing. Otherwise call `requestCancellation`, one
atomic write that moves the row from `authorized` to `cancelling` and stores `cancelEventXml`.

```ts
import type { Certificate, Environment } from "@bullcode/fiscal";
import { buildCancellation, SefinClient, SefinError, type CancellationReason, type SefinMessage } from "@bullcode/fiscal/nfse";

interface CancelRow {
  environment: Environment;
  status: "authorized" | "cancelling" | "cancelled";
  accessKey: string;
  cancelEventXml: string | null;
  cancelSentAt: Date | null;
  cancellationXml: string | null;
  messages: SefinMessage[] | null;
}

interface CancelStore {
  load(id: string): Promise<CancelRow>;
  /**
   * ONE atomic write, false when neither case applies:
   * - "authorized" to "cancelling": store `cancelEventXml`, clear `cancelSentAt`.
   * - "cancelling" with no lease held (a retry after 401/403): replace `cancelEventXml` only, so the new
   *   certificate signs it. Keep `cancelSentAt`: an earlier send may have gone through.
   */
  requestCancellation(id: string, cancelEventXml: string): Promise<boolean>;
  /** Lease on a "cancelling" row, or null while another worker holds one. A lease older than 10 minutes is stale. */
  claim(id: string): Promise<string | null>;
  patch(id: string, lease: string, values: Partial<CancelRow>): Promise<void>;
  /** Clears the lease if it is still `lease`. */
  release(id: string, lease: string): Promise<void>;
}

const CANCELLATION = "101101";
/** Events that cancel a note: cancellation, by substitution, granted in análise fiscal, de ofício. */
const CANCELLING_EVENTS = ["101101", "105102", "105104", "305101"];

/** The registered event that cancelled the note, if any. Throws SefinError when Sefin cannot answer. */
async function findCancellation(client: CancelClient, accessKey: string): Promise<string | null> {
  for (const type of CANCELLING_EVENTS) {
    const found = await client.findEvent(accessKey, type);
    if (found) return found;
  }
  return null;
}

/**
 * Request time, and the retry after a refused certificate. Throws RangeError on invalid input: answer the user,
 * no state change. False when the note cannot take a request now (cancelled, or a worker is sending).
 */
export async function requestCancel(
  store: CancelStore,
  id: string,
  certificate: Certificate,
  reason: CancellationReason,
  description: string,
): Promise<boolean> {
  const row = await store.load(id);
  const eventXml = buildCancellation(
    {
      environment: row.environment,
      accessKey: row.accessKey,
      authorCnpj: certificate.cnpj,
      reason, // 1 Erro na emissão, 2 Serviço não prestado, 9 Outros
      description,
      verAplic: "my-app-1.0",
      at: new Date(),
    },
    certificate,
  );
  return store.requestCancellation(id, eventXml);
}

/** The Sefin calls the worker makes. Pass a real `SefinClient` or a test fake. */
type CancelClient = Pick<SefinClient, "registerEvent" | "findEvent">;

/** Worker. Safe to call again for any row in "cancelling". */
export async function cancel(store: CancelStore, id: string, client: CancelClient) {
  const lease = await store.claim(id);
  if (!lease) return (await store.load(id)).status;
  try {
    return await send(store, id, lease, client);
  } finally {
    await store.release(id, lease);
  }
}

async function send(store: CancelStore, id: string, lease: string, client: CancelClient) {
  const save = (values: Partial<CancelRow>) => store.patch(id, lease, values);
  const row = await store.load(id);
  const cancelled = async (eventXml: string) => {
    await save({ status: "cancelled", cancellationXml: eventXml, messages: null });
    return "cancelled";
  };
  const stay = async (e: SefinError) => {
    await save({ messages: e.messages });
    return "cancelling";
  };

  try {
    // An earlier send may have gone through: look before sending again.
    if (row.cancelSentAt) {
      const found = await client.findEvent(row.accessKey, CANCELLATION);
      if (found) return cancelled(found);
    }
    await save({ cancelSentAt: new Date() });
    return cancelled(await client.registerEvent(row.accessKey, row.cancelEventXml!));
  } catch (e) {
    if (!(e instanceof SefinError)) throw e;
    if (e.kind !== "rejected" || e.httpStatus === 401 || e.httpStatus === 403) return stay(e);
    // A rejection is final only when no event cancelled the note (E0840 can mean a substitution did).
    try {
      const found = await findCancellation(client, row.accessKey);
      if (found) return cancelled(found);
    } catch {
      return stay(e);
    }
    await save({ status: "authorized", cancelEventXml: null, cancelSentAt: null, messages: e.messages });
    return "authorized";
  }
}
```

| Outcome | Row |
| --- | --- |
| `registerEvent` succeeds, or `findEvent` finds the event | `cancelled`, with the event XML |
| `rejected` and no cancelling event exists | Back to `authorized`, with the messages. Common causes: a municipal limit (deadline, default 730 days; value; taxes already paid). See the event codes in [codes.md](./codes.md). |
| `unavailable`, 401/403, or `findEvent` fails | Stays `cancelling`, with the messages. Retry later. On 401/403 the stored request is signed with the refused certificate: replace the certificate, then call `requestCancel` again with it. The event Id does not change, so `findEvent` still finds an earlier send. |

After the municipal deadline, only the taxpayer can ask for análise fiscal in the national portal.

## 12. Import notes from the ADN

The ADN distributes documents where the queried CNPJ is an interested party (provider, taker or intermediary),
including notes issued outside your app and their events. Official sources disagree on whether the issuer
receives its own notes and events back, so do not rely on the ADN import to confirm your own issuances or
cancellations: use `findAccessKeyByDpsId` and `findEvent` for those. Treat ADN documents for notes the app
already tracks as idempotent updates.

Store notes issued elsewhere in their own table (access key, environment, the `readNfseSummary` fields, the
XML, `authorized` or `cancelled`), not as `NoteRow`: they have no DPS, `serie` or `nDPS` of yours.

NSUs are numbered per interested CNPJ, so the cursor and the runner lock are scoped per (environment,
queried CNPJ): one `AdnStore` per pair.

```ts
import type { Certificate } from "@bullcode/fiscal";
import { AdnClient, type AdnDocument } from "@bullcode/fiscal/nfse";

// CANCELLING_EVENTS: the same list as in step 11.

interface AdnStore {
  /**
   * Lease on this (environment, CNPJ) importer, or null when another run holds it. Like `claim` in step 5, it
   * takes over a lease older than 10 minutes, so a crashed run never blocks the importer for good.
   */
  lock(): Promise<string | null>;
  /** Releases only this lease. */
  unlock(lease: string): Promise<void>;
  /** The highest NSU applied so far; 0 before the first import. */
  lastNsu(): Promise<number>;
  /** In ONE transaction fenced by `lease`: store the document and move the cursor forward to `doc.nsu`. */
  apply(lease: string, doc: AdnDocument): Promise<void>;
}

export async function importFromAdn(
  store: AdnStore,
  environment: "production" | "restricted",
  cnpj: string,
  /** The certificate of `cnpj` or of its root CNPJ. */
  certificate: Certificate,
) {
  const lease = await store.lock();
  if (!lease) return;
  try {
    const adn = new AdnClient({ environment, cnpj, certificate });
    for (;;) {
      const page = await adn.fetchDocuments(await store.lastNsu()); // up to 50, NSU order
      if (page.length === 0) return;
      for (const doc of page) await store.apply(lease, doc); // one at a time, in NSU order
    }
  } finally {
    await store.unlock(lease);
  }
}
```

What `apply` does, inside its transaction, failing when `lease` is no longer held:

- Store every document's raw `doc.xml` by `doc.nsu`, whatever its type.
- For `NFSE` and `EVENTO`, `doc.accessKey` is the note's key, read from the document's own XML and checked
  against the envelope. Use it as the key.
- `doc.type === "NFSE"`: when the app issued the note (a `NoteRow` with this `accessKey`), do not change it: the
  issuance worker owns its status. Otherwise upsert the imported note with `readNfseSummary(doc.xml)`.
- `doc.type === "EVENTO"`: read it with `readNfseEventSummary(doc.xml)`. When its `code` is in
  `CANCELLING_EVENTS`:
  - An imported note: set it to `cancelled`.
  - A `NoteRow` in `authorized` or `cancelling`: set it to `cancelled` and clear its lease in the same update, so a
    stale worker's later fenced write fails instead of overwriting `cancelled`.
  - A `NoteRow` in any other status (issuance not settled, or `conflict`): do not change it. Keep the event and
    alert a person: the note was cancelled outside the app before the app recorded it.
- Any other type: keep the raw XML only. Never fail the import on a type you do not know.
- The parsers throw `Error` on malformed XML. That rolls back the transaction and the cursor stays put: alert
  someone and retry later.
- Move the cursor only forward: `UPDATE ... SET last_nsu = $nsu WHERE last_nsu < $nsu`. If the transaction
  fails, the cursor does not move and the next run replays the document.

`fetchDocuments` rejects a page whose NSUs are not strictly increasing (`unavailable`), so `apply` always sees NSU
order. The library does not detect NSU gaps (documents the ADN skips). If the app needs that, track missing NSUs.

`AdnError.kind`: `rate_limited` (HTTP 429, stop and resume later), `rejected` (the certificate may not query
this CNPJ), `unavailable` (retry later, also for oversized or malformed answers). Run the import on a schedule,
not in a tight loop: after a page with no documents, wait at least one hour before asking again (ADN manual).

## 13. Test against produção restrita

Produção restrita issues real notes with no fiscal effect. The repository has scripts that do one full round:

```sh
pnpm build
node scripts/smoke-restricted.mjs cert.pfx password.txt          # domestic taker
node scripts/smoke-export-restricted.mjs cert.pfx password.txt   # foreign taker
node scripts/cancel-restricted.mjs cert.pfx password.txt <accessKey>
```

For unit tests in your app, pass a fake to `issue` (`IssueClient`) and `cancel` (`CancelClient`) instead of a
`SefinClient`, and throw `new SefinError(kind, messages, httpStatus)` to drive each branch of steps 6 and 11.

## Checklist

- [ ] Issuing municipality accepts the national emitters (codes.md)
- [ ] Certificate and password stored encrypted and never logged, `validTo` monitored; untrusted uploads parsed in a worker thread with a time limit
- [ ] `prest.CNPJ` equals `certificate.cnpj` and the row's `providerCnpj`
- [ ] `nDPS` from an atomic counter per environment, provider CNPJ and `serie`, fixed for the row's life
- [ ] Row created and signed DPS saved before the first `emit`
- [ ] `sentAt` saved before each `emit`, `accessKey` saved alone right after
- [ ] `rejected` (except E0014), certificate refusal and `unavailable` handled as in step 6
- [ ] Reconciliation by `dpsId` before any resend, with `isNfseOfDps(nfseXml, row.signedDpsXml)` on the found note
- [ ] One attempt per row at a time, every write fenced by the attempt's lease
- [ ] `nfseXml` stored as personal data; DANFSe rendered from it, with `situation` for a cancelled or substituted note
- [ ] `issued.alerts` logged
- [ ] Cancellation validated with `buildCancellation` at request time and started with one atomic `requestCancellation`; `cancelSentAt` persisted before each send; `findEvent` before any resend or final rejection
- [ ] ADN import: cursor and lease per (environment, CNPJ), one runner at a time, each document and a forward-only cursor in one transaction fenced by that lease; any cancelling event (101101, 105102, 105104, 305101) sets `cancelled` and clears the note's lease; never the only confirmation of the app's own notes or cancellations
- [ ] Environment stored per note and used for queries and cancellation
