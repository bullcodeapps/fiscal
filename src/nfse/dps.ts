import type { Environment } from "../core/environment";
import { brazilDateTime, decimal, group, leaf } from "../core/xml";

export type { Environment };

// Sefin validates each environment against a different schema. Produção runs
// nfse-esquemas_xsd-v1-01-20260209; produção restrita already runs the NT 009
// one (esquemas_prod_restrita_20261020). test/xsd holds both.

interface StreetAddress {
  xLgr: string;
  nro: string;
  xCpl?: string;
  xBairro: string;
}

export interface NationalAddress extends StreetAddress {
  /** IBGE municipality code, 7 digits. */
  cMun: string;
  CEP: string;
}

export interface ForeignAddress extends StreetAddress {
  /** ISO 3166-1 alpha-2 country code. */
  cPais: string;
  /** Postal code. */
  cEndPost: string;
  xCidade: string;
  /** State, province or region. */
  xEstProvReg: string;
}

export type Address = NationalAddress | ForeignAddress;

export interface Provider {
  CNPJ: string;
  IM?: string;
  regTrib: {
    /** 1 Não optante, 2 MEI, 3 ME/EPP. 4 (Pendente, NT 009) is in neither XSD in force yet. */
    opSimpNac: 1 | 2 | 3;
    /**
     * Required when opSimpNac = 3. 1 federal taxes and ISSQN in the SN, 2 federal in the SN and ISSQN by the
     * municipality, 3 both outside the SN (a sublimit or limit was exceeded).
     */
    regApTribSN?: 1 | 2 | 3;
    /** 0 Nenhum, 1 Ato cooperado, 2 Estimativa, 3 Microempresa municipal, 4 Notário ou registrador, 5 Profissional autônomo, 6 Sociedade de profissionais, 9 Outros. */
    regEspTrib: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 9;
  };
}

interface TakerBase {
  xNome: string;
  fone?: string;
  email?: string;
}

export type NationalTaker = TakerBase &
  ({ CNPJ: string } | { CPF: string }) & {
    /** Mandatory when the IBS/CBS incidence falls on the taker's address in Brazil, which depends on `cIndOp` (E0239). */
    end?: Address;
  };

/** A taker abroad. Sefin requires its foreign address (E0242). */
export type ForeignTaker = TakerBase &
  (
    /** Tax ID issued abroad. */
    | { NIF: string }
    /** Reason for not informing the NIF: 1 exempt, 2 not required (Sefin rejects 0, E0226). */
    | { cNaoNIF: 1 | 2 }
  ) & {
    end: ForeignAddress;
  };

export type Taker = NationalTaker | ForeignTaker;

/** Comércio exterior group (export of services). Codes follow tiposSimples_v1.01.xsd. */
export interface ForeignTrade {
  /** 1 Transfronteiriço, 2 Consumo no Brasil, 3 Movimento temporário de pessoas físicas, 4 Consumo no exterior (Sefin rejects 0, E0333). */
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

export interface Service {
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

export interface MovableGood {
  /** NCM, 8 digits. */
  cNCMBemMovel: string;
  xNCMBemMovel: string;
  qtdNCMBemMovel: number;
}

export interface IbsCbs {
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

export type TotTrib =
  /** Simples Nacional ME/EPP: the regime's approximate total tax rate. */
  | { pTotTribSN: number }
  /** 0: do not inform approximate taxes. */
  | { indTotTrib: 0 };

export interface Values {
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
export interface DpsInput {
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

export interface BuiltDps {
  /** DPS Id. Persist it: `SefinClient.findAccessKeyByDpsId` reconciles by it. */
  id: string;
  /** Unsigned DPS XML. Pass it to `signDps`. */
  xml: string;
}

const NAMESPACE = "http://www.sped.fazenda.gov.br/nfse";
const LAYOUT_VERSION = "1.01";

export interface DpsKey {
  cLocEmi: string;
  CNPJ: string;
  serie: string;
  nDPS: string;
}

/** "DPS" + cLocEmi(7) + tpInsc(1) + inscrição(14) + série(5) + nDPS(15). */
export function dpsId(input: DpsKey): string {
  const CNPJ_INSCRIPTION_TYPE = "2";
  return (
    "DPS" +
    input.cLocEmi +
    CNPJ_INSCRIPTION_TYPE +
    input.CNPJ.padStart(14, "0") +
    input.serie.padStart(5, "0") +
    input.nDPS.padStart(15, "0")
  );
}

function address(end: Address | undefined): string {
  if (!end) return "";
  return group(
    "end",
    "cMun" in end
      ? group("endNac", leaf("cMun", end.cMun), leaf("CEP", end.CEP))
      : group(
          "endExt",
          leaf("cPais", end.cPais),
          leaf("cEndPost", end.cEndPost),
          leaf("xCidade", end.xCidade),
          leaf("xEstProvReg", end.xEstProvReg),
        ),
    leaf("xLgr", end.xLgr),
    leaf("nro", end.nro),
    leaf("xCpl", end.xCpl),
    leaf("xBairro", end.xBairro),
  );
}

function taker(toma: Taker | undefined): string {
  if (!toma) return "";
  return group(
    "toma",
    "CNPJ" in toma
      ? leaf("CNPJ", toma.CNPJ)
      : "CPF" in toma
        ? leaf("CPF", toma.CPF)
        : "NIF" in toma
          ? leaf("NIF", toma.NIF)
          : leaf("cNaoNIF", toma.cNaoNIF),
    leaf("xNome", toma.xNome),
    address(toma.end),
    leaf("fone", toma.fone),
    leaf("email", toma.email),
  );
}

function locPrest(serv: Service): string {
  if ((serv.cLocPrestacao === undefined) === (serv.cPaisPrestacao === undefined)) {
    throw new Error("serv: exactly one of cLocPrestacao or cPaisPrestacao");
  }
  return group(
    "locPrest",
    leaf("cLocPrestacao", serv.cLocPrestacao),
    leaf("cPaisPrestacao", serv.cPaisPrestacao),
  );
}

function foreignTrade(value: ForeignTrade | undefined): string {
  if (!value) return "";
  return group(
    "comExt",
    leaf("mdPrestacao", value.mdPrestacao),
    leaf("vincPrest", value.vincPrest),
    leaf("tpMoeda", value.tpMoeda),
    leaf("vServMoeda", decimal(value.vServMoeda)),
    leaf("mecAFComexP", value.mecAFComexP),
    leaf("mecAFComexT", value.mecAFComexT),
    leaf("movTempBens", value.movTempBens),
    leaf("mdic", value.mdic),
  );
}

function totTrib(value: TotTrib): string {
  return group(
    "totTrib",
    "pTotTribSN" in value
      ? leaf("pTotTribSN", decimal(value.pTotTribSN))
      : leaf("indTotTrib", value.indTotTrib),
  );
}

/** Flip to every environment once NT 009 reaches produção. */
function usesNt009Layout(environment: Environment): boolean {
  return environment === "restricted";
}

function ibsCbs(value: IbsCbs | undefined, nt009: boolean): string {
  if (!value) return "";
  const situation = [leaf("CST", value.CST), leaf("cClassTrib", value.cClassTrib)];
  return group(
    "IBSCBS",
    nt009 ? "" : leaf("finNFSe", 0),
    leaf("indFinal", value.indFinal),
    leaf("cIndOp", value.cIndOp),
    leaf("indDest", value.indDest),
    ...(value.bensMoveis ?? []).map((good) =>
      group(
        "bensMoveis",
        leaf("cNCMBemMovel", good.cNCMBemMovel),
        leaf("xNCMBemMovel", good.xNCMBemMovel),
        leaf("qtdNCMBemMovel", good.qtdNCMBemMovel),
      ),
    ),
    group(
      "valores",
      group("trib", nt009 ? situation.join("") : group("gIBSCBS", ...situation)),
    ),
  );
}

/** The fields that form the DPS Id attribute, which is not escaped. */
function assertKeyFields(input: DpsInput): void {
  if (!/^\d{7}$/.test(input.cLocEmi)) throw new Error("cLocEmi: must be the 7-digit IBGE code");
  if (!/^[0-9A-Z]{12}\d{2}$/.test(input.prest.CNPJ)) throw new Error("prest: CNPJ must be 14 digits or uppercase letters");
  if (!/^\d{1,5}$/.test(input.serie)) throw new Error("serie: must be 1 to 5 digits");
  if (!/^[1-9]\d{0,14}$/.test(input.nDPS)) throw new Error("nDPS: must be 1 to 15 digits, not starting with 0");
}

/** Sefin business rules the XSD does not express. */
function assertExportRules(input: DpsInput): void {
  const { toma, serv, valores } = input;
  const identities = toma ? ["CNPJ", "CPF", "NIF", "cNaoNIF"].filter((key) => key in toma) : [];
  if (toma && identities.length !== 1) throw new Error("toma: exactly one of CNPJ, CPF, NIF or cNaoNIF");
  const foreignId = toma !== undefined && ("NIF" in toma || "cNaoNIF" in toma);
  const foreignAddress = toma?.end !== undefined && "cPais" in toma.end;

  if (foreignId && !foreignAddress) {
    throw new Error("toma: a taker identified by NIF or cNaoNIF requires a foreign address in end (E0242)");
  }
  if (foreignAddress && !foreignId) {
    throw new Error("toma: a foreign address in end requires the taker to be identified by NIF or cNaoNIF (E0223)");
  }
  if ((foreignAddress || serv.cPaisPrestacao !== undefined || valores.tribISSQN === 3) && !serv.comExt) {
    throw new Error("serv: comExt is required for a taker abroad, a service abroad or an export (E0330)");
  }
  if ((input.prest.regTrib.opSimpNac as number) === 4) {
    throw new Error("prest: opSimpNac 4 (pendente) is not accepted by Sefin yet");
  }
  if ((valores.tribISSQN as number) === 2) throw new Error("valores: tribISSQN 2 (immunity) is not supported");
  if ((valores.tpRetISSQN as number) === 3) {
    throw new Error("valores: tpRetISSQN 3 (withheld by an intermediary) is not supported");
  }
  if (valores.tribISSQN === 3 && !valores.cPaisResult) {
    throw new Error("valores: tribISSQN 3 (export of services) requires cPaisResult (E0590)");
  }
}

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
export function buildDps(input: DpsInput): BuiltDps {
  assertKeyFields(input);
  assertExportRules(input);
  const id = dpsId({
    cLocEmi: input.cLocEmi,
    CNPJ: input.prest.CNPJ,
    serie: input.serie,
    nDPS: input.nDPS,
  });
  const { prest, serv, valores } = input;
  const nt009 = usesNt009Layout(input.environment);

  const infDps =
    `<infDPS Id="${id}">` +
    leaf("tpAmb", input.environment === "production" ? 1 : 2) +
    leaf("dhEmi", brazilDateTime(input.dhEmi)) +
    leaf("verAplic", input.verAplic) +
    leaf("serie", input.serie) +
    leaf("nDPS", input.nDPS) +
    leaf("dCompet", input.dCompet) +
    leaf("tpEmit", 1) +
    (nt009 ? leaf("finNFSe", 0) : "") +
    leaf("cLocEmi", input.cLocEmi) +
    group(
      "prest",
      leaf("CNPJ", prest.CNPJ),
      leaf("IM", prest.IM),
      group(
        "regTrib",
        leaf("opSimpNac", prest.regTrib.opSimpNac),
        leaf("regApTribSN", prest.regTrib.regApTribSN),
        leaf("regEspTrib", prest.regTrib.regEspTrib),
      ),
    ) +
    taker(input.toma) +
    group(
      "serv",
      locPrest(serv),
      group(
        "cServ",
        leaf("cTribNac", serv.cTribNac),
        leaf("cTribMun", serv.cTribMun),
        nt009 ? leaf("cNBS", serv.cNBS) : "",
        leaf("xDescServ", serv.xDescServ),
        nt009 ? "" : leaf("cNBS", serv.cNBS),
      ),
      foreignTrade(serv.comExt),
    ) +
    group(
      "valores",
      group("vServPrest", leaf("vServ", decimal(valores.vServ))),
      group(
        "trib",
        group(
          "tribMun",
          leaf("tribISSQN", valores.tribISSQN),
          leaf("cPaisResult", valores.cPaisResult),
          leaf("tpRetISSQN", valores.tpRetISSQN),
          leaf("pAliq", decimal(valores.pAliq)),
        ),
        totTrib(valores.totTrib),
      ),
    ) +
    ibsCbs(input.IBSCBS, nt009) +
    "</infDPS>";

  return {
    id,
    xml: `<DPS xmlns="${NAMESPACE}" versao="${LAYOUT_VERSION}">${infDps}</DPS>`,
  };
}
