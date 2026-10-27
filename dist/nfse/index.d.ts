import { E as Environment, C as Certificate } from '../environment-fHjUnJ9t.js';

/**
 * DPS (Declaração de Prestação de Serviço) input. Field names are the
 * official layout names, so each one can be looked up in the Anexo I / VI
 * spreadsheets of the NFS-e Nacional documentation.
 *
 * Layout: what Sefin Nacional 1.6.0 accepts (validated against produção
 * restrita on 2026-10-26). NT 009 moves more fields (regApIBSCBSSN, indDest
 * outside IBSCBS) but the live schema does not take them yet.
 */
interface Address {
    /** IBGE municipality code, 7 digits. */
    cMun: string;
    CEP: string;
    xLgr: string;
    nro: string;
    xCpl?: string;
    xBairro: string;
}
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
type Taker = ({
    CNPJ: string;
} | {
    CPF: string;
}) & {
    xNome: string;
    /** Mandatory whenever the DPS declares IBS/CBS (E0239). */
    end?: Address;
    fone?: string;
    email?: string;
};
interface Service {
    /** IBGE code of the municipality where the service is provided. */
    cLocPrestacao: string;
    /** Código de Tributação Nacional, 6 digits without dots (e.g. "170303"). */
    cTribNac: string;
    cTribMun?: string;
    /** Mandatory whenever the DPS declares IBS/CBS (E0322). 9 digits, no dots. */
    cNBS?: string;
    xDescServ: string;
}
interface MovableGood {
    /** NCM, 8 digits. */
    cNCMBemMovel: string;
    xNCMBemMovel: string;
    qtdNCMBemMovel: number;
}
interface IbsCbs {
    indFinal: 0 | 1;
    /** Código indicador da operação (Anexo VII). */
    cIndOp: string;
    /** 0: the taker is the recipient. 1: someone else is. */
    indDest: 0 | 1;
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
    /** 1 Tributável, 2 Imunidade, 3 Exportação, 4 Não incidência. */
    tribISSQN: 1 | 2 | 3 | 4;
    /** 1 Não retido, 2 Retido pelo tomador, 3 Retido pelo intermediário. */
    tpRetISSQN: 1 | 2 | 3;
    /** ISS rate in %, only when the municipality does not fix it. */
    pAliq?: number;
    totTrib: TotTrib;
}
interface DpsInput {
    environment: Environment;
    dhEmi: Date;
    /** YYYY-MM-DD. */
    dCompet: string;
    /** 00001-49999 is the range for the taxpayer's own software. */
    serie: string;
    nDPS: string;
    /** IBGE code of the issuing municipality. */
    cLocEmi: string;
    /** Issuing software version, max 20 characters. */
    verAplic: string;
    prest: Provider;
    toma?: Taker;
    serv: Service;
    valores: Values;
    IBSCBS?: IbsCbs;
}
interface BuiltDps {
    id: string;
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
declare function buildDps(input: DpsInput): BuiltDps;

declare function signDps(dpsXml: string, certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">): string;

interface SefinMessage {
    code: string;
    description: string;
    complement?: string;
}
/**
 * - `rejected`: Sefin answered and refused the DPS. Nothing was issued;
 *   fix the input and send a new DPS (same Id is fine).
 * - `unavailable`: no definitive answer (timeout, 5xx, network). The DPS
 *   MAY have been authorized: call `findAccessKeyByDpsId` before resending.
 */
declare class SefinError extends Error {
    readonly kind: "rejected" | "unavailable";
    readonly messages: SefinMessage[];
    readonly httpStatus?: number | undefined;
    readonly name = "SefinError";
    constructor(kind: "rejected" | "unavailable", messages: SefinMessage[], httpStatus?: number | undefined);
}
interface IssuedNfse {
    accessKey: string;
    nfseXml: string;
    dpsId: string;
    alerts: SefinMessage[];
}
interface SefinClientOptions {
    environment: Environment;
    certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">;
    timeoutMs?: number;
}
declare class SefinClient {
    private readonly baseUrl;
    private readonly agent;
    private readonly timeoutMs;
    constructor(options: SefinClientOptions);
    /** Sends a signed DPS. Authorization is synchronous. */
    emit(signedDpsXml: string): Promise<IssuedNfse>;
    /**
     * Registers a signed event (e.g. `buildCancellation`). Returns the event
     * XML Sefin signed back. Resending an event that already went through is
     * rejected by Sefin, so an `unavailable` error is safe to retry.
     */
    registerEvent(accessKey: string, signedEventXml: string): Promise<string>;
    /** Reconciliation after an `unavailable` error. Null when Sefin never authorized it. */
    findAccessKeyByDpsId(dpsId: string): Promise<string | null>;
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
    /** CNPJ or CPF digits of the taker; null when the note has none. */
    takerDocument: string | null;
    /** vServ in cents. */
    serviceValueCents: number;
    /** dCompet, YYYY-MM-DD. */
    competenceDate: string | null;
    /** xDescServ. */
    description: string | null;
}
/** What a caller needs to confirm an existing NFS-e is the one it meant to issue. */
declare function readNfseSummary(nfseXml: string): NfseSummary;

export { type Address, type BuiltDps, type CancellationInput, type CancellationReason, type DanfseModel, type DpsInput, type DpsKey, Environment, type IbsCbs, type IssuedNfse, type MovableGood, type NfseSummary, type Provider, SefinClient, type SefinClientOptions, SefinError, type SefinMessage, type Service, type Taker, type TotTrib, type Values, buildCancellation, buildDanfseModel, buildDps, dpsId, readNfseSummary, renderDanfse, signDps };
