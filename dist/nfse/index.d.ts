import { E as Environment, C as Certificate } from '../environment-Cf62aP_K.js';

interface StreetAddress {
    xLgr: string;
    nro: string;
    xCpl?: string;
    xBairro: string;
}
interface NationalAddress extends StreetAddress {
    /** IBGE municipality code, 7 digits. */
    cMun: string;
    CEP: string;
}
interface ForeignAddress extends StreetAddress {
    /** ISO 3166-1 alpha-2 country code. */
    cPais: string;
    /** Postal code. */
    cEndPost: string;
    xCidade: string;
    /** State, province or region. */
    xEstProvReg: string;
}
type Address = NationalAddress | ForeignAddress;
interface Provider {
    CNPJ: string;
    IM?: string;
    regTrib: {
        /** 1 Não optante, 2 MEI, 3 ME/EPP, 4 Pendente. */
        opSimpNac: 1 | 2 | 3 | 4;
        /** Required when opSimpNac = 3. */
        regApTribSN?: 1 | 2 | 3;
        regEspTrib: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 9;
    };
}
interface TakerBase {
    xNome: string;
    fone?: string;
    email?: string;
}
type NationalTaker = TakerBase & ({
    CNPJ: string;
} | {
    CPF: string;
}) & {
    /** Mandatory when the IBS/CBS incidence falls on the taker's address in Brazil, which depends on `cIndOp` (E0239). */
    end?: Address;
};
/** A taker abroad. Sefin requires its foreign address (E0242). */
type ForeignTaker = TakerBase & (
/** Tax ID issued abroad. */
{
    NIF: string;
}
/** Reason for not informing the NIF: 1 exempt, 2 not required (Sefin rejects 0, E0226). */
 | {
    cNaoNIF: 1 | 2;
}) & {
    end: ForeignAddress;
};
type Taker = NationalTaker | ForeignTaker;
/** Comércio exterior group (export of services). Codes follow tiposSimples_v1.01.xsd. */
interface ForeignTrade {
    /** 1 Transfronteiriço, 2 Consumo no Brasil, 3 Presença comercial no exterior, 4 Movimento temporário de pessoas (Sefin rejects 0, E0333). */
    mdPrestacao: 1 | 2 | 3 | 4;
    /** 0 Sem vínculo, 1 Controlada, 2 Controladora, 3 Coligada, 4 Matriz, 5 Filial, 6 Outro, 9 Desconhecido. */
    vincPrest: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 9;
    /** BACEN currency code, 3 digits (e.g. "220" for USD). */
    tpMoeda: string;
    /** Service value in `tpMoeda`. */
    vServMoeda: number;
    /** Provider's foreign trade support mechanism, 2 digits ("01" none). */
    mecAFComexP: string;
    /** Taker's foreign trade support mechanism, 2 digits ("01" none). */
    mecAFComexT: string;
    /**
     * 1: not linked to a temporary movement of goods. 2 and 3 need import/export declaration numbers,
     * which the two Sefin layouts name differently (nDI/nRE vs nDUIMP/nDUE); not supported yet.
     */
    movTempBens: 1;
    /** 0 Não enviar, 1 Enviar ao MDIC. */
    mdic: 0 | 1;
}
interface Service {
    /** IBGE code of the municipality where the service is provided. */
    cLocPrestacao?: string;
    /** ISO country code where the service is provided. Exactly one of cLocPrestacao / cPaisPrestacao. */
    cPaisPrestacao?: string;
    /** Código de Tributação Nacional, 6 digits without dots (e.g. "170303"). */
    cTribNac: string;
    cTribMun?: string;
    /** Mandatory whenever the DPS declares IBS/CBS (E0322). 9 digits, no dots. */
    cNBS?: string;
    xDescServ: string;
    /** Required for a taker abroad, a service abroad (`cPaisPrestacao`) or `tribISSQN` 3 (E0330). */
    comExt?: ForeignTrade;
}
interface MovableGood {
    /** NCM, 8 digits. */
    cNCMBemMovel: string;
    xNCMBemMovel: string;
    qtdNCMBemMovel: number;
}
interface IbsCbs {
    indFinal: 0 | 1;
    /** Código indicador da operação. The table depends on the environment: see docs/codes.md. */
    cIndOp: string;
    /** 0: the taker is the recipient. A different recipient (1, with the `dest` group) is not supported yet. */
    indDest: 0;
    /** Mandatory for cTribNac 99.04.01 (rental of movable goods). */
    bensMoveis?: MovableGood[];
    CST: string;
    cClassTrib: string;
}
type TotTrib = 
/** Simples Nacional ME/EPP: the regime's approximate total tax rate. */
{
    pTotTribSN: number;
}
/** 0: do not inform approximate taxes. */
 | {
    indTotTrib: 0;
};
interface Values {
    vServ: number;
    /** 1 Tributável, 3 Exportação, 4 Não incidência. 2 (Imunidade) needs tpImunidade, which is not supported. */
    tribISSQN: 1 | 3 | 4;
    /** ISO code of the country where the result of an exported service happens; Sefin requires it on exports (E0590). */
    cPaisResult?: string;
    /** 1 Não retido, 2 Retido pelo tomador. 3 (by the intermediary) needs the interm group, which is not supported. */
    tpRetISSQN: 1 | 2;
    /** ISS rate in %, only when the municipality does not fix it. */
    pAliq?: number;
    totTrib: TotTrib;
}
/**
 * DPS (Declaração de Prestação de Serviço) input. Field names are the official layout names, so each one
 * can be looked up in the Anexo I / VI spreadsheets of the NFS-e Nacional documentation.
 * @see docs/dps-input.md for every field and complete examples.
 */
interface DpsInput {
    /** Must match the `SefinClient` environment that will send it. */
    environment: Environment;
    /** Emission time. Sefin rejects a time in the future. */
    dhEmi: Date;
    /** YYYY-MM-DD. */
    dCompet: string;
    /** 00001-49999 is the range for the taxpayer's own software. */
    serie: string;
    /** Positive integer as a string, unique per CNPJ + serie + environment. Allocate it atomically. */
    nDPS: string;
    /** IBGE code of the issuing municipality. */
    cLocEmi: string;
    /** Issuing software version, max 20 characters. */
    verAplic: string;
    /** `prest.CNPJ` must be the certificate's CNPJ. */
    prest: Provider;
    toma?: Taker;
    serv: Service;
    valores: Values;
    IBSCBS?: IbsCbs;
}
interface BuiltDps {
    /** DPS Id. Persist it: `SefinClient.findAccessKeyByDpsId` reconciles by it. */
    id: string;
    /** Unsigned DPS XML. Pass it to `signDps`. */
    xml: string;
}
interface DpsKey {
    cLocEmi: string;
    CNPJ: string;
    serie: string;
    nDPS: string;
}
/** "DPS" + cLocEmi(7) + tpInsc(1) + inscrição(14) + série(5) + nDPS(15). */
declare function dpsId(input: DpsKey): string;
/**
 * Builds the unsigned DPS XML in the layout Sefin validates for `input.environment`.
 * Pure and offline.
 *
 * @throws {Error} When `input` breaks a Sefin rule the XSD does not express. The message starts with the
 * DPS group (`toma:`, `serv:`, `valores:`) and names the Sefin code it prevents.
 * @example
 * const dps = buildDps(input);
 * const signed = signDps(dps.xml, certificate);
 * @see docs/dps-input.md
 */
declare function buildDps(input: DpsInput): BuiltDps;

/**
 * Signs a DPS from `buildDps` with the certificate (XMLDSig, RSA-SHA256). Persist the result before
 * calling `SefinClient.emit`: after an `unavailable` error the same signed XML is resent.
 */
declare function signDps(dpsXml: string, certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">): string;

interface SefinMessage {
    code: string;
    description: string;
    complement?: string;
}
/**
 * - `rejected`: Sefin answered and refused the DPS. Nothing was issued, except
 *   with code E0014 (this DPS already has a note: reconcile, do not resend);
 *   fix the input and send the corrected DPS with the same `nDPS`.
 * - `unavailable`: no definitive answer (timeout, 5xx, network). The DPS
 *   MAY have been authorized: call `findAccessKeyByDpsId` before resending.
 *
 * Either kind with `httpStatus` 401 or 403: Sefin refused the TLS client
 * certificate (expired, revoked, not an e-CNPJ) and did not process the DPS.
 */
declare class SefinError extends Error {
    readonly kind: "rejected" | "unavailable";
    readonly messages: SefinMessage[];
    readonly httpStatus?: number | undefined;
    readonly name = "SefinError";
    constructor(kind: "rejected" | "unavailable", messages: SefinMessage[], httpStatus?: number | undefined);
}
interface IssuedNfse {
    /** Chave de acesso, 50 characters (letters only with an alphanumeric CNPJ). Persist it first. */
    accessKey: string;
    /** The authorized NFS-e XML signed by Sefin. Store it: the DANFSe is rendered from it. */
    nfseXml: string;
    dpsId: string;
    /** Non-blocking warnings. */
    alerts: SefinMessage[];
}
interface SefinClientOptions {
    environment: Environment;
    /** The provider's A1, used for mTLS. */
    certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">;
    /** Idle time per request (no data received), not a total deadline. Default 30000. Throws `SefinError` `unavailable`. */
    timeoutMs?: number;
}
/**
 * Sefin Nacional over mTLS: emission, events, reconciliation and NFS-e lookup.
 * Network and Sefin failures throw `SefinError`; see its `kind` for what to do next. `registerEvent`
 * throws `Error` when given anything but a `pedRegEvento`.
 * @see docs/integration.md sections 5 to 7
 */
declare class SefinClient {
    private readonly baseUrl;
    private readonly agent;
    private readonly timeoutMs;
    constructor(options: SefinClientOptions);
    /** Sends a signed DPS. Authorization is synchronous. */
    emit(signedDpsXml: string): Promise<IssuedNfse>;
    /**
     * Registers a signed event (e.g. `buildCancellation`). Returns the event
     * XML Sefin signed back. After an `unavailable` error the event may have gone
     * through: a retry is safe, but its rejection does not prove the event failed
     * (see docs/integration.md, cancellation).
     */
    registerEvent(accessKey: string, signedEventXml: string): Promise<string>;
    /**
     * The registered event of this type and sequence (e.g. "101101", 1 for a cancellation), or null when
     * the note has none. Use it before treating a cancellation as failed or resending one whose outcome
     * is unknown.
     */
    findEvent(accessKey: string, eventType: string, sequence?: number): Promise<string | null>;
    /** Reconciliation after an `unavailable` error. Null when Sefin never authorized it. */
    findAccessKeyByDpsId(dpsId: string): Promise<string | null>;
    /**
     * The authorized NFS-e XML. `rejected` (HTTP 404) when Sefin does not know the key yet: for a key you just
     * emitted or reconciled, that is propagation, so retry later.
     */
    getNfseXml(accessKey: string): Promise<string>;
    private request;
}

/**
 * DANFSe v2.0 (NT 008 v1.02, Anexo I) for an authorized NFS-e XML, one A4
 * page. The optional "canhoto" block is left out; its space goes to
 * "Informações Complementares" (item 2.3.3).
 */
declare function renderDanfse(nfseXml: string): Promise<Buffer>;

/**
 * DANFSe v2.0 content (NT 008 SE/CGNFS-e v1.02, 14/07/2026, Anexo I),
 * derived only from the NFS-e XML as the NT requires. Drawing lives in
 * render.ts; this file decides what each field shows.
 */
/** Grid column (0-3) and span, as in the Anexo I model. */
interface DanfseField {
    label: string;
    value: string;
    col: 0 | 1 | 2 | 3;
    span?: 1 | 2 | 3 | 4;
    shaded?: boolean;
}
interface DanfseBlock {
    title: string;
    /** Replaces the fields when the NT allows the block to collapse. */
    message?: string;
    rows: DanfseField[][];
    /** Row height in cm (0.63 regular, 0.67 for identification and totals). */
    rowHeight: number;
}
interface DanfseModel {
    accessKey: string;
    qrCodeUrl: string;
    header: {
        municipality: string;
        generator: string;
        environment: string;
    };
    /** tpAmb = 2: the header must say "NFS-e SEM VALIDADE JURÍDICA". */
    withoutLegalValue: boolean;
    identification: DanfseField[][];
    blocks: DanfseBlock[];
    serviceCodeDescription: string;
    serviceDescription: string;
    complementaryInfo: string[];
}
declare function buildDanfseModel(nfseXml: string): DanfseModel;

/** 1 Erro na emissão, 2 Serviço não prestado, 9 Outros. */
type CancellationReason = 1 | 2 | 9;
interface CancellationInput {
    environment: Environment;
    accessKey: string;
    /** The issuer's CNPJ (the event author). */
    authorCnpj: string;
    reason: CancellationReason;
    /** 15 to 255 characters. */
    description: string;
    verAplic: string;
    at: Date;
}
/** Signed pedRegEvento for event e101101 (Cancelamento de NFS-e). */
declare function buildCancellation(input: CancellationInput, certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">): string;

interface NfseSummary {
    accessKey: string;
    /** nNFSe, the number the municipality shows on the note. */
    number: string | null;
    /** CNPJ (may have letters) or CPF of the taker, unmasked; null when the note has none. */
    takerDocument: string | null;
    /** vServ in cents. */
    serviceValueCents: number;
    /** dCompet, YYYY-MM-DD. */
    competenceDate: string | null;
    /** xDescServ. */
    description: string | null;
    /** CNPJ (may have letters) or CPF of the provider (emit), unmasked. */
    providerDocument: string | null;
    /** xNome of the taker. */
    takerName: string | null;
    /** NIF of a foreign taker. */
    takerNif: string | null;
    /** dhEmi of the DPS, as written (with offset). */
    issuedAt: string | null;
    /** vISSQN in cents; 0 when the note has none. */
    issqnCents: number;
    /** regApTribSN = 1: the ISSQN is paid inside the Simples Nacional DAS, not on its own. */
    issqnInSimples: boolean;
}
interface NfseEventSummary {
    /** chNFSe the event refers to. */
    accessKey: string;
    /** Event code without the "e" (101101 is cancellation). */
    code: string | null;
}
/** What a caller needs to confirm an existing NFS-e is the one it meant to issue. */
declare function readNfseSummary(nfseXml: string): NfseSummary;
/** Reads an event XML distributed by the ADN (the registered event wraps the original request). */
declare function readNfseEventSummary(eventXml: string): NfseEventSummary;
/**
 * True when `nfseXml` is the note Sefin issued for exactly this signed DPS: same DPS Id and same
 * signed content. Use it after reconciliation (E0014, timeout) before accepting the note found by
 * DPS Id, because another DPS that reused the number has the same Id but different content.
 */
declare function isNfseOfDps(nfseXml: string, signedDpsXml: string): boolean;

interface AdnMessage {
    code: string;
    description: string;
}
/**
 * - `rejected`: the ADN refused the query (e.g. certificate not allowed).
 * - `rate_limited`: HTTP 429; wait before the next call.
 * - `unavailable`: no definitive answer (timeout, 5xx, network, unknown body).
 */
declare class AdnError extends Error {
    readonly kind: "rejected" | "rate_limited" | "unavailable";
    readonly messages: AdnMessage[];
    readonly httpStatus?: number | undefined;
    readonly name = "AdnError";
    constructor(kind: "rejected" | "rate_limited" | "unavailable", messages: AdnMessage[], httpStatus?: number | undefined);
}
interface AdnDocument {
    nsu: number;
    accessKey: string | null;
    /** "NFSE" for a note; other values (events) carry their own XML. */
    type: string;
    xml: string;
}
interface AdnClientOptions {
    environment: Environment;
    /** CNPJ whose documents are queried (punctuation is ignored, letters kept); the certificate must belong to its root. */
    cnpj: string;
    certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">;
    timeoutMs?: number;
}
/** Distribution of the documents where the certificate's CNPJ is provider, taker or intermediary. */
declare class AdnClient {
    private readonly baseUrl;
    private readonly cnpj;
    private readonly agent;
    private readonly timeoutMs;
    constructor(options: AdnClientOptions);
    /**
     * The next page (up to 50) of documents with an NSU above `lastNsu`, in NSU order. Start with 0 and
     * call again with the highest NSU received until a call returns nothing.
     */
    fetchDocuments(lastNsu: number): Promise<AdnDocument[]>;
}

export { type Address, AdnClient, type AdnClientOptions, type AdnDocument, AdnError, type AdnMessage, type BuiltDps, type CancellationInput, type CancellationReason, type DanfseModel, type DpsInput, type DpsKey, Environment, type ForeignAddress, type ForeignTrade, type IbsCbs, type IssuedNfse, type MovableGood, type NationalAddress, type NfseEventSummary, type NfseSummary, type Provider, SefinClient, type SefinClientOptions, SefinError, type SefinMessage, type Service, type Taker, type TotTrib, type Values, buildCancellation, buildDanfseModel, buildDps, dpsId, isNfseOfDps, readNfseEventSummary, readNfseSummary, renderDanfse, signDps };
