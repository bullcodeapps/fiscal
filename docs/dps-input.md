# DpsInput reference

`buildDps(input: DpsInput)` returns `{ id, xml }`. Field names are the official layout names, so every field
maps to the Anexo I / VI spreadsheets at https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica.

Conventions:

- Codes are strings of digits with no dots or dashes (`cTribNac: "170303"`, not `"17.03.03"`).
- Money is a number in reais with at most 2 decimals (`vServ: 1500.5`). Keep amounts as integer cents in the
  app and pass `cents / 100`.
- Omit an optional field instead of passing `undefined` or `""`.

## Top level

| Field | Type | Notes |
| --- | --- | --- |
| `environment` | `"production" \| "restricted"` | tpAmb 1 or 2. Also picks the XML layout each environment validates. |
| `dhEmi` | `Date` | Emission time. Written in Brazil time with offset. |
| `dCompet` | `string` | Competence date, `YYYY-MM-DD`. |
| `serie` | `string` | 5 digits. `00001` to `49999` is the range for the taxpayer's own software. |
| `nDPS` | `string` | DPS number, positive integer, unique per CNPJ, `serie` and environment. |
| `cLocEmi` | `string` | IBGE code (7 digits) of the issuing municipality. Use `findMunicipalityCode(city, uf)`. |
| `verAplic` | `string` | Your software name and version, max 20 characters. |
| `prest` | `Provider` | The issuer. |
| `toma` | `Taker` | Optional. The client. Omit only when the note has no identified taker. |
| `serv` | `Service` | The service. |
| `valores` | `Values` | Amounts and ISSQN. |
| `IBSCBS` | `IbsCbs` | IBS/CBS group of the tax reform. Optional in the type, but legally required for most services: see below. |

## prest (Provider)

| Field | Type | Notes |
| --- | --- | --- |
| `CNPJ` | `string` | 14 digits or uppercase letters (alphanumeric CNPJ), no mask. Must equal `certificate.cnpj`. |
| `IM` | `string` | Optional. Municipal registration, when the municipality requires it. |
| `regTrib.opSimpNac` | `1 \| 2 \| 3 \| 4` | 1 Não optante, 2 MEI, 3 ME/EPP (Simples Nacional), 4 Pendente. |
| `regTrib.regApTribSN` | `1 \| 2 \| 3` | Required when `opSimpNac` is 3. 1: ISSQN paid inside the Simples Nacional DAS. |
| `regTrib.regEspTrib` | `0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 9` | Special regime. 0 none. |

## toma (Taker)

Exactly one identity field:

| Identity | Taker |
| --- | --- |
| `CNPJ: string` (14 digits or uppercase letters, no mask) | Brazilian company |
| `CPF: string` (11 digits) | Brazilian person |
| `NIF: string` | Taker abroad, foreign tax id |
| `cNaoNIF: 1 \| 2` | Taker abroad without NIF: 1 exempt, 2 not required (Sefin rejects 0, E0226) |

Other fields: `xNome` (required, legal name), `fone`, `email`, `end`.

`end` is a `NationalAddress` or a `ForeignAddress`:

| NationalAddress | ForeignAddress |
| --- | --- |
| `cMun` (IBGE, 7 digits) | `cPais` (ISO 3166-1 alpha-2) |
| `CEP` (8 digits) | `cEndPost` (postal code) |
|  | `xCidade`, `xEstProvReg` (state, province or region) |

Both also take `xLgr` (street), `nro` (number, `"SN"` when none), `xCpl` (optional complement), `xBairro` (district).

A national taker's `end` is optional in the type. Sefin requires the taker's CNPJ/CPF and national address when
the IBS/CBS incidence falls on the taker's address in Brazil, which depends on `cIndOp` (E0239). Sending the
address of a Brazilian taker always is the simple safe choice; a taker abroad never has one.

## serv (Service)

| Field | Type | Notes |
| --- | --- | --- |
| `cLocPrestacao` | `string` | IBGE code where the service is provided. |
| `cPaisPrestacao` | `string` | ISO country where the service is provided. Exactly one of the two. Requires `comExt`, also with a Brazilian taker (E0330). |
| `cTribNac` | `string` | Código de Tributação Nacional, 6 digits (`"170303"`). |
| `cTribMun` | `string` | Optional. Municipal tax code, 3 digits, when the municipality defines one. |
| `cNBS` | `string` | NBS, 9 digits. Required whenever the DPS has `IBSCBS` (E0322). |
| `xDescServ` | `string` | Free text description shown on the note. |
| `comExt` | `ForeignTrade` | Foreign trade data. Required when the taker is abroad, the service is performed abroad (`cPaisPrestacao`) or `tribISSQN` is 3 (E0330). See below. |

### serv.comExt (ForeignTrade)

| Field | Type | Notes |
| --- | --- | --- |
| `mdPrestacao` | `1..4` | 1 Transfronteiriço, 2 Consumo no Brasil, 3 Presença comercial no exterior, 4 Movimento temporário de pessoas (Sefin rejects 0, E0333). Remote software work is usually 1. |
| `vincPrest` | `0..6 \| 9` | Link between provider and taker. 0 Sem vínculo. |
| `tpMoeda` | `string` | BACEN currency code, 3 digits. `"220"` USD, `"978"` EUR. |
| `vServMoeda` | `number` | Service value in that currency. |
| `mecAFComexP` | `string` | Provider's support mechanism, 2 digits. `"01"` none. |
| `mecAFComexT` | `string` | Taker's support mechanism, 2 digits. `"01"` none. |
| `movTempBens` | `1` | Not linked to a temporary movement of goods. 2 and 3 need declaration numbers and are not supported yet. |
| `mdic` | `0 \| 1` | 0 do not send to MDIC, 1 send. |

## valores (Values)

| Field | Type | Notes |
| --- | --- | --- |
| `vServ` | `number` | Service value in reais. |
| `tribISSQN` | `1 \| 2 \| 3 \| 4` | 1 Tributável, 2 Imunidade, 3 Exportação, 4 Não incidência. |
| `cPaisResult` | `string` | ISO country where the result happens. Required when `tribISSQN` is 3 (E0590). |
| `tpRetISSQN` | `1 \| 2 \| 3` | 1 Não retido, 2 Retido pelo tomador, 3 Retido pelo intermediário. |
| `pAliq` | `number` | Optional. ISS rate in %, only when the municipality does not fix it. |
| `totTrib` | `{ pTotTribSN: number } \| { indTotTrib: 0 }` | Simples Nacional ME/EPP: the regime's approximate total rate. Otherwise `{ indTotTrib: 0 }`. |

## IBSCBS (IbsCbs)

When it is mandatory ([CGNFS-e guidance](https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-orienta-sobre-os-prazos-para%20destaque-de-ibs-cbs-nas-notas-fiscais-de-servico),
Ato Conjunto RFB/CGIBS nº 4/2026):

- Since 2026-10-01: services subject to ISS in the LC 116 list, except subitems 1.03, 1.05, 1.09 and 16.01.
- From 2026-12-01: digital platforms, LC 116 subitems 1.03, 1.05, 1.09 and 16.01, intangible goods outside the
  list, condominium charges, rentals of movable and immovable property, and every other service.
- From 2027-01-01: Simples Nacional taxpayers who opted in September 2026 to state IBS/CBS.

Until 2026-12-31 Sefin does not reject a DPS without `IBSCBS`, but the note is noncompliant and the issuer is
subject to sanctions. Send `IBSCBS` whenever the issuer is in one of the groups above.

| Field | Type | Notes |
| --- | --- | --- |
| `indFinal` | `0 \| 1` | 1 when the taker is the final consumer. |
| `cIndOp` | `string` | Operation indicator code (Anexo VII). |
| `indDest` | `0` | The taker is the recipient. Only `0` is supported: the group for a different recipient is not built yet. |
| `bensMoveis` | `MovableGood[]` | Required for `cTribNac` 99.04.01 (rental of movable goods): `{ cNCMBemMovel, xNCMBemMovel, qtdNCMBemMovel }`. |
| `CST` | `string` | Tax situation code, 3 digits. |
| `cClassTrib` | `string` | Tax classification code, 6 digits. |

The tests and smoke scripts use `{ indFinal: 0, cIndOp: "100301", indDest: 0, CST: "000", cClassTrib: "000001" }`:
a B2B service with standard taxation. Confirm `cIndOp`, `CST` and `cClassTrib` for your operation with an accountant.

## Rules buildDps enforces

`buildDps` throws `Error` before any network call:

| Message starts with | Rule |
| --- | --- |
| `serv: exactly one of cLocPrestacao or cPaisPrestacao` | Set exactly one of the two. |
| `toma: a taker identified by NIF or cNaoNIF requires a foreign address in end (E0242)` | A foreign taker needs a `ForeignAddress`. |
| `toma: a foreign address in end requires the taker to be identified by NIF or cNaoNIF (E0223)` | A `ForeignAddress` needs `NIF` or `cNaoNIF`. |
| `serv: comExt is required for a taker abroad, a service abroad or an export (E0330)` | Add `serv.comExt` for a foreign taker, `cPaisPrestacao`, or `tribISSQN` 3. |
| `valores: tribISSQN 3 (export of services) requires cPaisResult (E0590)` | Exports need `valores.cPaisResult`. |

Everything else (code tables, field lengths, municipal rules) is validated by Sefin and comes back as a
`SefinError` with `kind: "rejected"`. See [errors.md](./errors.md).

## Complete inputs

The provider below is a Simples Nacional ME/EPP in Itajaí/SC (`cLocEmi: "4208203"`). Replace the CNPJ with
`certificate.cnpj`. The codes `cTribNac: "170303"` and `cNBS: "114012900"` (administrative planning and
management) are the ones Sefin authorized in the smoke tests; use the codes of your own service.

### Domestic company (CNPJ) taker

```ts
import type { DpsInput } from "@bullcode/fiscal/nfse";

const input: DpsInput = {
  environment: "restricted",
  dhEmi: new Date(),
  dCompet: "2026-11-12",
  serie: "00001",
  nDPS: "1",
  cLocEmi: "4208203",
  verAplic: "my-app-1.0",
  prest: { CNPJ: certificate.cnpj, regTrib: { opSimpNac: 3, regApTribSN: 1, regEspTrib: 0 } },
  toma: {
    CNPJ: "00000000000191",
    xNome: "BANCO DO BRASIL SA",
    email: "financeiro@example.com",
    end: { cMun: "5300108", CEP: "70040912", xLgr: "SAUN QUADRA 5 LOTE B", nro: "SN", xBairro: "ASA NORTE" },
  },
  serv: {
    cLocPrestacao: "4208203",
    cTribNac: "170303",
    cNBS: "114012900",
    xDescServ: "Consultoria administrativa - novembro/2026",
  },
  valores: { vServ: 1500, tribISSQN: 1, tpRetISSQN: 1, totTrib: { pTotTribSN: 6 } },
  IBSCBS: { indFinal: 0, cIndOp: "100301", indDest: 0, CST: "000", cClassTrib: "000001" },
};
```

### Domestic person (CPF) taker

Same as above with a different `toma`. A person is usually the final consumer, so set `indFinal: 1`
(confirm `cIndOp` with an accountant):

```ts
const input: DpsInput = {
  ...companyInput,
  toma: {
    CPF: "52998224725",
    xNome: "MARIA DA SILVA",
    end: { cMun: "4208203", CEP: "88301000", xLgr: "RUA EXEMPLO", nro: "100", xBairro: "CENTRO" },
  },
  IBSCBS: { indFinal: 1, cIndOp: "100301", indDest: 0, CST: "000", cClassTrib: "000001" },
};
```

### Export of services (taker abroad)

`cLocPrestacao` / `cPaisPrestacao` is where the service is performed: remote work done from Brazil uses
`cLocPrestacao` with the provider's municipality. `cPaisResult` is the country where the result happens, usually
the taker's. Confirm the scenario with an accountant: Sefin answers E0529 when it sees the service as taxable in Brazil.
A Brazilian taker with a service performed abroad (`cPaisPrestacao`) also needs `comExt` (E0330). The taker
below has no Brazilian address, so E0239 does not apply.

```ts
const input: DpsInput = {
  environment: "restricted",
  dhEmi: new Date(),
  dCompet: "2026-11-12",
  serie: "00001",
  nDPS: "2",
  cLocEmi: "4208203",
  verAplic: "my-app-1.0",
  prest: { CNPJ: certificate.cnpj, regTrib: { opSimpNac: 3, regApTribSN: 1, regEspTrib: 0 } },
  toma: {
    NIF: "98-7654321",
    xNome: "ACME INC",
    end: {
      cPais: "US",
      cEndPost: "94105",
      xCidade: "San Francisco",
      xEstProvReg: "CA",
      xLgr: "Market St",
      nro: "1",
      xBairro: "SoMa",
    },
  },
  serv: {
    cLocPrestacao: "4208203",
    cTribNac: "170303",
    cNBS: "114012900",
    xDescServ: "Management consulting services - November 2026",
    comExt: {
      mdPrestacao: 1,
      vincPrest: 0,
      tpMoeda: "220",
      vServMoeda: 2000,
      mecAFComexP: "01",
      mecAFComexT: "01",
      movTempBens: 1,
      mdic: 0,
    },
  },
  valores: { vServ: 10000, tribISSQN: 3, cPaisResult: "US", tpRetISSQN: 1, totTrib: { pTotTribSN: 6 } },
  // The values the export smoke test sent. Exports usually have their own cIndOp / cClassTrib rows: confirm them.
  IBSCBS: { indFinal: 0, cIndOp: "100301", indDest: 0, CST: "000", cClassTrib: "000001" },
};
```

`vServ` is the value in reais (converted at the rate you use for the invoice). `vServMoeda` is the value in
`tpMoeda`.

## Helpers

```ts
import { findMunicipalityCode, findMunicipality } from "@bullcode/fiscal";

findMunicipalityCode("Itajai", "SC"); // "4208203" (accents, case and hyphens ignored); null when unknown
findMunicipality("4208203");          // { name: "Itajaí", uf: "SC" }
```

```ts
import { dpsId } from "@bullcode/fiscal/nfse";

dpsId({ cLocEmi, CNPJ, serie, nDPS }); // the Id buildDps would produce, without building the XML
```
