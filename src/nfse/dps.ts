import type { Environment } from "../core/environment";
import { brazilDateTime, decimal, group, leaf } from "../core/xml";

export type { Environment };

/**
 * DPS (Declaração de Prestação de Serviço) input. Field names are the
 * official layout names, so each one can be looked up in the Anexo I / VI
 * spreadsheets of the NFS-e Nacional documentation.
 *
 * Layout: Sefin validates each environment against a different schema.
 * Produção runs nfse-esquemas_xsd-v1-01-20260209; produção restrita already
 * runs the NT 009 one (esquemas_prod_restrita_20261020). test/xsd holds both.
 */

export interface Address {
  /** IBGE municipality code, 7 digits. */
  cMun: string;
  CEP: string;
  xLgr: string;
  nro: string;
  xCpl?: string;
  xBairro: string;
}

export interface Provider {
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

export type Taker = ({ CNPJ: string } | { CPF: string }) & {
  xNome: string;
  /** Mandatory whenever the DPS declares IBS/CBS (E0239). */
  end?: Address;
  fone?: string;
  email?: string;
};

export interface Service {
  /** IBGE code of the municipality where the service is provided. */
  cLocPrestacao: string;
  /** Código de Tributação Nacional, 6 digits without dots (e.g. "170303"). */
  cTribNac: string;
  cTribMun?: string;
  /** Mandatory whenever the DPS declares IBS/CBS (E0322). 9 digits, no dots. */
  cNBS?: string;
  xDescServ: string;
}

export interface MovableGood {
  /** NCM, 8 digits. */
  cNCMBemMovel: string;
  xNCMBemMovel: string;
  qtdNCMBemMovel: number;
}

export interface IbsCbs {
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

export type TotTrib =
  /** Simples Nacional ME/EPP: the regime's approximate total tax rate. */
  | { pTotTribSN: number }
  /** 0: do not inform approximate taxes. */
  | { indTotTrib: 0 };

export interface Values {
  vServ: number;
  /** 1 Tributável, 2 Imunidade, 3 Exportação, 4 Não incidência. */
  tribISSQN: 1 | 2 | 3 | 4;
  /** 1 Não retido, 2 Retido pelo tomador, 3 Retido pelo intermediário. */
  tpRetISSQN: 1 | 2 | 3;
  /** ISS rate in %, only when the municipality does not fix it. */
  pAliq?: number;
  totTrib: TotTrib;
}

export interface DpsInput {
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

export interface BuiltDps {
  id: string;
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
    group("endNac", leaf("cMun", end.cMun), leaf("CEP", end.CEP)),
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
    "CNPJ" in toma ? leaf("CNPJ", toma.CNPJ) : leaf("CPF", toma.CPF),
    leaf("xNome", toma.xNome),
    address(toma.end),
    leaf("fone", toma.fone),
    leaf("email", toma.email),
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

export function buildDps(input: DpsInput): BuiltDps {
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
      group("locPrest", leaf("cLocPrestacao", serv.cLocPrestacao)),
      group(
        "cServ",
        leaf("cTribNac", serv.cTribNac),
        leaf("cTribMun", serv.cTribMun),
        nt009 ? leaf("cNBS", serv.cNBS) : "",
        leaf("xDescServ", serv.xDescServ),
        nt009 ? "" : leaf("cNBS", serv.cNBS),
      ),
    ) +
    group(
      "valores",
      group("vServPrest", leaf("vServ", decimal(valores.vServ))),
      group(
        "trib",
        group(
          "tribMun",
          leaf("tribISSQN", valores.tribISSQN),
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
