import { XMLParser } from "fast-xml-parser";
import { findMunicipality } from "../../core/municipalities";

/**
 * DANFSe v2.0 content (NT 008 SE/CGNFS-e v1.02, 14/07/2026, Anexo I),
 * derived only from the NFS-e XML as the NT requires. Drawing lives in
 * render.ts; this file decides what each field shows.
 */

/** Grid column (0-3) and span, as in the Anexo I model. */
export interface DanfseField {
  label: string;
  value: string;
  col: 0 | 1 | 2 | 3;
  span?: 1 | 2 | 3 | 4;
  shaded?: boolean;
}

export interface DanfseBlock {
  title: string;
  /** Replaces the fields when the NT allows the block to collapse. */
  message?: string;
  rows: DanfseField[][];
  /** Row height in cm (0.63 regular, 0.67 for identification and totals). */
  rowHeight: number;
}

export interface DanfseModel {
  accessKey: string;
  qrCodeUrl: string;
  header: { municipality: string; generator: string; environment: string };
  /** tpAmb = 2: the header must say "NFS-e SEM VALIDADE JURÍDICA". */
  withoutLegalValue: boolean;
  identification: DanfseField[][];
  blocks: DanfseBlock[];
  serviceCodeDescription: string;
  serviceDescription: string;
  complementaryInfo: string[];
}

const EMPTY = "-";

const TP_EMIT: Record<string, string> = { "1": "Prestador", "2": "Tomador", "3": "Intermediário" };
const C_STAT: Record<string, string> = {
  "100": "NFS-e Gerada",
  "101": "NFS-e de Substituição Gerada",
  "102": "NFS-e de Decisão Judicial ou Administrativa",
  "103": "NFS-e Avulsa",
};
const FIN_NFSE: Record<string, string> = {
  "0": "NFS-e regular",
  "1": "NFS-e de crédito",
  "2": "NFS-e de débito",
};
const OP_SIMP_NAC: Record<string, string> = {
  "1": "Não Optante",
  "2": "Optante - Microempreendedor Individual (MEI)",
  "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)",
  "4": "Optante - Pendente",
};
const REG_AP_TRIB_SN: Record<string, string> = {
  "1": "Regime de apuração dos tributos federais e municipal pelo Simples Nacional",
  "2": "Regime de apuração dos tributos federais pelo SN e o ISSQN pela NFS-e conforme respectiva legislação municipal do tributo",
  "3": "Regime de apuração dos tributos federais e municipal pela NFS-e conforme respectivas legislações federal e municipal de cada tributo",
};
const TRIB_ISSQN: Record<string, string> = {
  "1": "Operação Tributável",
  "2": "Imunidade",
  "3": "Exportação de Serviço",
  "4": "Não Incidência",
};
const TP_RET_ISSQN: Record<string, string> = {
  "1": "Não Retido",
  "2": "Retido pelo Tomador",
  "3": "Retido pelo Intermediário",
};
const REG_ESP_TRIB: Record<string, string> = {
  "0": "Nenhum",
  "1": "Ato Cooperado (Cooperativa)",
  "2": "Estimativa",
  "3": "Microempresa Municipal",
  "4": "Notário ou Registrador",
  "5": "Profissional Autônomo",
  "6": "Sociedade de Profissionais",
  "9": "Outros",
};
const AMB_GER: Record<string, string> = { "1": "Prefeitura", "2": "Sistema Nacional da NFS-e" };
const TP_AMB: Record<string, string> = { "1": "Produção", "2": "Homologação" };

const ISSQN_NOT_INCIDENT = "4";
const QR_CODE_BASE = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=";

type Node = Record<string, unknown> | undefined;

const text = (node: Node, key: string): string | undefined => {
  const value = node?.[key];
  return value === undefined || value === null || value === "" ? undefined : String(value);
};
const child = (node: Node, key: string): Node => node?.[key] as Node;
const or = (value: string | undefined) => value ?? EMPTY;
const describe = (table: Record<string, string>, code: string | undefined) =>
  code === undefined ? EMPTY : (table[code] ?? code);

function money(value: string | undefined): string {
  if (value === undefined) return EMPTY;
  return `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(value: string | undefined): string {
  if (value === undefined) return EMPTY;
  return `${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function sum(...values: (string | undefined)[]): string | undefined {
  const present = values.filter((v): v is string => v !== undefined);
  return present.length ? present.reduce((total, v) => total + Number(v), 0).toFixed(2) : undefined;
}

function document(node: Node): string {
  const cnpj = text(node, "CNPJ");
  if (cnpj) return cnpj.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\w{2})$/, "$1.$2.$3/$4-$5");
  const cpf = text(node, "CPF");
  if (cpf) return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return or(text(node, "NIF"));
}

/** "dd/mm/aaaa hh:mm:ss" exactly as stamped, without timezone shifts. */
function dateTime(value: string | undefined): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}` : EMPTY;
}

function date(value: string | undefined): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : EMPTY;
}

function cityUf(code: string | undefined): string {
  const city = code ? findMunicipality(code) : null;
  return city ? `${city.name} / ${city.uf}` : EMPTY;
}

interface Party {
  node: Node;
  /** The emitter's address lives in `enderNac`; DPS parties use `end/endNac`. */
  address: Node;
  nationalAddress: Node;
  /** `end/endExt` of a taker abroad. */
  foreignAddress?: Node;
}

function partyFields(party: Party, withMunicipalRegistration: boolean): DanfseField[][] {
  const { node, address, nationalAddress, foreignAddress } = party;
  const cMun = text(nationalAddress, "cMun");
  const cep = text(nationalAddress, "CEP")?.replace(/^(\d{2})(\d{3})(\d{3})$/, "$1.$2-$3");
  const street = [
    text(address, "xLgr"),
    text(address, "nro"),
    text(address, "xCpl"),
    text(address, "xBairro"),
  ].filter(Boolean);
  return [
    [
      { label: "CNPJ / CPF / NIF", value: document(node), col: 1 },
      ...(withMunicipalRegistration
        ? [{ label: "Indicador Municipal (Inscrição)", value: or(text(node, "IM")), col: 2 as const }]
        : []),
      { label: "Telefone", value: or(text(node, "fone")), col: 3 },
    ],
    [
      { label: "Nome / Nome Empresarial", value: or(text(node, "xNome")), col: 0, span: 2 },
      ...(foreignAddress
        ? [
            {
              label: "Cidade / Estado",
              value: [text(foreignAddress, "xCidade"), text(foreignAddress, "xEstProvReg")]
                .map(or)
                .join(" / "),
              col: 2 as const,
            },
            {
              label: "País / Código Postal",
              value: `${or(text(foreignAddress, "cPais"))} / ${or(text(foreignAddress, "cEndPost"))}`,
              col: 3 as const,
            },
          ]
        : [
            { label: "Município / Sigla UF", value: cityUf(cMun), col: 2 as const },
            { label: "Código IBGE / CEP", value: cMun || cep ? `${or(cMun)} / ${or(cep)}` : EMPTY, col: 3 as const },
          ]),
    ],
    [
      { label: "Endereço", value: street.length ? street.join(", ") : EMPTY, col: 0, span: 2 },
      { label: "E-mail", value: or(text(node, "email")), col: 2, span: 2 },
    ],
  ];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => name === "bensMoveis",
});

export function buildDanfseModel(nfseXml: string): DanfseModel {
  const root = parser.parse(nfseXml) as Record<string, Node>;
  const inf = child(root.NFSe, "infNFSe");
  const infDps = child(child(inf, "DPS"), "infDPS");
  const prest = child(infDps, "prest");
  const regTrib = child(prest, "regTrib");
  const emit = child(inf, "emit");
  const toma = child(infDps, "toma");
  const interm = child(infDps, "interm");
  const serv = child(infDps, "serv");
  const cServ = child(serv, "cServ");
  const dpsValores = child(infDps, "valores");
  const tribMun = child(child(dpsValores, "trib"), "tribMun");
  const tribFed = child(child(dpsValores, "trib"), "tribFed");
  const piscofins = child(tribFed, "piscofins");
  const totTrib = child(child(dpsValores, "trib"), "totTrib");
  const nfseValores = child(inf, "valores");
  const ibsCbs = child(inf, "IBSCBS");
  const ibsCbsValores = child(ibsCbs, "valores");
  const totCibs = child(ibsCbs, "totCIBS");
  const gIbs = child(totCibs, "gIBS");
  const dpsIbsCbs = child(infDps, "IBSCBS");
  const dpsIbsCbsTrib = child(child(dpsIbsCbs, "valores"), "trib");

  const accessKey = String(inf?.["@_Id"] ?? "").replace(/^NFS/, "");
  const tpAmb = text(infDps, "tpAmb");
  const dCompet = text(infDps, "dCompet");
  const tribIssqn = text(tribMun, "tribISSQN");
  const vIbsTot = text(gIbs, "vIBSTot");
  const vCbs = text(child(totCibs, "gCBS"), "vCBS");

  const blocks: DanfseBlock[] = [];

  const provider = partyFields(
    { node: { ...emit, ...prest, CNPJ: text(prest, "CNPJ") ?? text(emit, "CNPJ") }, address: child(emit, "enderNac"), nationalAddress: child(emit, "enderNac") },
    true,
  );
  provider.push([
    { label: "Simples Nacional na Data de Competência", value: describe(OP_SIMP_NAC, text(regTrib, "opSimpNac")), col: 0 },
    { label: "Regime de Apuração Tributária pelo SN", value: describe(REG_AP_TRIB_SN, text(regTrib, "regApTribSN")), col: 1, span: 3 },
  ]);
  blocks.push({ title: "PRESTADOR / FORNECEDOR", rows: provider, rowHeight: 0.63 });

  blocks.push(
    toma
      ? {
          title: "TOMADOR / ADQUIRENTE",
          rows: partyFields({ node: toma, address: child(toma, "end"), nationalAddress: child(child(toma, "end"), "endNac"), foreignAddress: child(child(toma, "end"), "endExt") }, true),
          rowHeight: 0.63,
        }
      : { title: "TOMADOR / ADQUIRENTE", message: "TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", rows: [], rowHeight: 0.63 },
  );

  const dest = child(dpsIbsCbs, "dest");
  blocks.push(
    dest
      ? {
          title: "DESTINATÁRIO DA OPERAÇÃO",
          rows: partyFields({ node: dest, address: child(dest, "end"), nationalAddress: child(child(dest, "end"), "endNac"), foreignAddress: child(child(dest, "end"), "endExt") }, false),
          rowHeight: 0.63,
        }
      : {
          title: "DESTINATÁRIO DA OPERAÇÃO",
          message:
            text(dpsIbsCbs, "indDest") === "1"
              ? "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e"
              : "O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO",
          rows: [],
          rowHeight: 0.63,
        },
  );

  blocks.push(
    interm
      ? {
          title: "INTERMEDIÁRIO DA OPERAÇÃO",
          rows: partyFields({ node: interm, address: child(interm, "end"), nationalAddress: child(child(interm, "end"), "endNac"), foreignAddress: child(child(interm, "end"), "endExt") }, true),
          rowHeight: 0.63,
        }
      : { title: "INTERMEDIÁRIO DA OPERAÇÃO", message: "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", rows: [], rowHeight: 0.63 },
  );

  const cTribNac = text(cServ, "cTribNac");
  const cTribMun = text(cServ, "cTribMun");
  const cNbs = text(cServ, "cNBS");
  const prestacaoUf = findMunicipality(text(child(serv, "locPrest"), "cLocPrestacao") ?? "")?.uf;
  blocks.push({
    title: "SERVIÇO PRESTADO",
    rows: [
      [
        {
          label: "Código de Tributação Nacional / Municipal",
          value: `${cTribNac ? cTribNac.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1.$2.$3") : EMPTY} / ${or(cTribMun)}`,
          col: 1,
        },
        { label: "Código da NBS", value: cNbs ? cNbs.replace(/^(\d)(\d{4})(\d{2})(\d{2})$/, "$1.$2.$3.$4") : EMPTY, col: 2 },
        {
          label: "Local da Prestação / Sigla UF / País",
          value: text(inf, "xLocPrestacao") ? `${text(inf, "xLocPrestacao")} / ${or(prestacaoUf)} / BR` : EMPTY,
          col: 3,
        },
      ],
    ],
    rowHeight: 0.63,
  });

  if (tribIssqn === ISSQN_NOT_INCIDENT) {
    blocks.push({
      title: "TRIBUTAÇÃO MUNICIPAL (ISSQN)",
      message: "TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN",
      rows: [],
      rowHeight: 0.63,
    });
  } else {
    const exigSusp = child(tribMun, "exigSusp");
    const incidUf = findMunicipality(text(inf, "cLocIncid") ?? "")?.uf;
    const rows: DanfseField[][] = [
      [
        { label: "Tipo de Tributação do ISSQN", value: describe(TRIB_ISSQN, tribIssqn), col: 1 },
        {
          label: "Município / Sigla UF / País de Incidência do ISSQN",
          value: text(inf, "xLocIncid") ? `${text(inf, "xLocIncid")} / ${or(incidUf)} / BR` : EMPTY,
          col: 2,
          span: 2,
        },
      ],
      [
        { label: "Regime Especial de Tributação do ISSQN", value: describe(REG_ESP_TRIB, text(regTrib, "regEspTrib")), col: 0 },
        { label: "Tipo de Imunidade do ISSQN", value: or(text(tribMun, "tpImunidade")), col: 1 },
        {
          label: "Suspensão da Exigibilidade do ISSQN",
          value: exigSusp
            ? text(exigSusp, "tpSusp") === "1"
              ? "Exigibilidade Suspensa por Decisão Judicial"
              : "Exigibilidade Suspensa por Processo Administrativo"
            : EMPTY,
          col: 2,
        },
        { label: "Número Processo Suspensão", value: or(text(exigSusp, "nProcesso")), col: 3 },
      ],
      [
        { label: "Benefício Municipal", value: or(text(nfseValores, "tpBM")), col: 0 },
        { label: "Cálculo do BM", value: money(text(nfseValores, "vCalcBM")), col: 1 },
        { label: "Total Deduções/Reduções", value: money(text(nfseValores, "vCalcDR")), col: 2 },
        { label: "Desconto Incondicionado", value: money(text(child(dpsValores, "vDescCondIncond"), "vDescIncond")), col: 3 },
      ],
      [
        { label: "BC ISSQN", value: money(text(nfseValores, "vBC")), col: 0 },
        { label: "Alíquota Aplicada", value: percent(text(nfseValores, "pAliqAplic")), col: 1 },
        { label: "Retenção do ISSQN", value: describe(TP_RET_ISSQN, text(tribMun, "tpRetISSQN")), col: 2 },
        { label: "ISSQN Apurado", value: money(text(nfseValores, "vISSQN")), col: 3 },
      ],
    ];
    blocks.push({
      title: "TRIBUTAÇÃO MUNICIPAL (ISSQN)",
      // Nota 5: the benefit/deduction row may go when all its fields are empty.
      rows: rows.filter((row, index) => index !== 2 || row.some((field) => field.value !== EMPTY)),
      rowHeight: 0.63,
    });
  }

  const federalRows: DanfseField[][] = [
    [
      { label: "IRRF", value: money(text(tribFed, "vRetIRRF")), col: 1 },
      { label: "Contribuição Previdenciária - Retida", value: money(text(tribFed, "vRetCP")), col: 2 },
      { label: "Contribuições Sociais - Retidas", value: money(text(tribFed, "vRetCSLL")), col: 3 },
    ],
  ];
  // Nota 6: PIS/COFINS line only for competence up to the end of 2026.
  if (!dCompet || Number(dCompet.slice(0, 4)) <= 2026) {
    federalRows.push([
      { label: "PIS - Débito Apuração Própria", value: money(text(piscofins, "vPis")), col: 0 },
      { label: "COFINS - Débito Apuração Própria", value: money(text(piscofins, "vCofins")), col: 1 },
      { label: "Descrição Contrib. Sociais - Retidas", value: or(text(piscofins, "tpRetPisCofins")), col: 2, span: 2 },
    ]);
  }
  blocks.push({ title: "TRIBUTAÇÃO FEDERAL (EXCETO CBS)", rows: federalRows, rowHeight: 0.63 });

  const uf = child(ibsCbsValores, "uf");
  const mun = child(ibsCbsValores, "mun");
  const fed = child(ibsCbsValores, "fed");
  const incidCity = text(ibsCbs, "cLocalidadeIncid");
  blocks.push({
    title: "TRIBUTAÇÃO IBS / CBS",
    rows: [
      [
        { label: "CST / cClassTrib", value: `${or(text(dpsIbsCbsTrib, "CST"))} / ${or(text(dpsIbsCbsTrib, "cClassTrib"))}`, col: 1 },
        {
          label: "Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF",
          value: [
            or(text(dpsIbsCbs, "cIndOp")),
            or(incidCity),
            or(text(ibsCbs, "xLocalidadeIncid")),
            or(findMunicipality(incidCity ?? "")?.uf),
          ].join(" / "),
          col: 2,
          span: 2,
        },
      ],
      [
        { label: "Exclusões e Reduções da Base de Cálculo", value: money(sum(text(child(dpsValores, "vDescCondIncond"), "vDescIncond"), text(nfseValores, "vISSQN"), text(piscofins, "vPis"), text(piscofins, "vCofins"))), col: 0 },
        { label: "Base de Cálculo Após Exclusões e Reduções", value: money(text(ibsCbsValores, "vBC")), col: 1 },
        {
          label: "Red. Alíquota IBS / Red. Alíquota CBS",
          value: `${percent(text(uf, "pRedAliqUF"))} / ${percent(text(mun, "pRedAliqMun"))} / ${percent(text(fed, "pRedAliqCBS"))}`,
          col: 2,
        },
        { label: "Alíquota - IBS UF / IBS Mun", value: `${percent(text(uf, "pIBSUF"))} / ${percent(text(mun, "pIBSMun"))}`, col: 3 },
      ],
      [
        { label: "Alíq. Efetiva Municipal - IBS", value: percent(text(mun, "pAliqEfetMun")), col: 0 },
        { label: "Valor Apurado Municipal - IBS", value: money(text(child(gIbs, "gIBSMunTot"), "vIBSMun")), col: 1 },
        { label: "Alíq. Efetiva Estadual - IBS", value: percent(text(uf, "pAliqEfetUF")), col: 2 },
        { label: "Valor Apurado Estadual - IBS", value: money(text(child(gIbs, "gIBSUFTot"), "vIBSUF")), col: 3 },
      ],
      [
        { label: "Valor Total Apurado - IBS", value: money(vIbsTot), col: 0 },
        { label: "Alíquota - CBS", value: percent(text(fed, "pCBS")), col: 1 },
        { label: "Alíquota Efetiva - CBS", value: percent(text(fed, "pAliqEfetCBS")), col: 2 },
        { label: "Valor Total Apurado - CBS", value: money(vCbs), col: 3 },
      ],
    ],
    rowHeight: 0.63,
  });

  blocks.push({
    title: "VALOR TOTAL DA NFS-E",
    rows: [
      [
        { label: "VALOR DA OPERAÇÃO / SERVIÇO", value: money(text(child(dpsValores, "vServPrest"), "vServ")), col: 1 },
        { label: "Desconto Incondicionado", value: money(text(child(dpsValores, "vDescCondIncond"), "vDescIncond")), col: 2 },
        { label: "Desconto Condicionado", value: money(text(child(dpsValores, "vDescCondIncond"), "vDescCond")), col: 3 },
      ],
      [
        { label: "Total das Retenções (ISSQN / Federais)", value: money(text(nfseValores, "vTotalRet")), col: 0 },
        { label: "VALOR LÍQUIDO DA NFS-e", value: money(text(nfseValores, "vLiq")), col: 1 },
        { label: "Total do IBS/CBS", value: money(sum(vIbsTot, vCbs)), col: 2 },
        { label: "VALOR LÍQUIDO DA NFS-e + IBS/CBS", value: money(text(totCibs, "vTotNF")), col: 3, shaded: true },
      ],
    ],
    rowHeight: 0.67,
  });

  const infoCompl = child(serv, "infoCompl");
  const complementaryInfo = [
    text(infoCompl, "xInfComp") && `Inf. Cont.: ${text(infoCompl, "xInfComp")}`,
    text(child(infDps, "subst"), "chSubstda") && `NFS-e Subst.: ${text(child(infDps, "subst"), "chSubstda")}`,
    text(infoCompl, "docRef") && `Doc. Ref.: ${text(infoCompl, "docRef")}`,
    text(infoCompl, "idDocTec") && `Doc. Tec.: ${text(infoCompl, "idDocTec")}`,
    text(infoCompl, "xPed") && `Núm. Ped.: ${text(infoCompl, "xPed")}`,
    text(inf, "xOutInf") && `Inf. A. T. Mun.: ${text(inf, "xOutInf")}`,
    ...((dpsIbsCbs?.bensMoveis as Node[] | undefined) ?? []).map(
      (good) => `Bem Móvel: NCM ${or(text(good, "cNCMBemMovel"))} - ${or(text(good, "xNCMBemMovel"))} (${or(text(good, "qtdNCMBemMovel"))})`,
    ),
  ].filter((line): line is string => Boolean(line));
  complementaryInfo.push(approximateTaxes(totTrib));

  return {
    accessKey,
    qrCodeUrl: `${QR_CODE_BASE}${accessKey}`,
    header: {
      municipality: `Município: ${or(text(inf, "xLocEmi"))} - ${or(text(child(emit, "enderNac"), "UF"))}`,
      generator: `Ambiente Gerador: ${describe(AMB_GER, text(inf, "ambGer"))}`,
      environment: `Tipo de Ambiente: ${describe(TP_AMB, tpAmb)}`,
    },
    withoutLegalValue: tpAmb === "2",
    identification: [
      [
        { label: "NÚMERO DA NFS-E", value: or(text(inf, "nNFSe")), col: 0 },
        { label: "COMPETÊNCIA DA NFS-E", value: date(dCompet), col: 1 },
        { label: "DATA E HORA DA EMISSÃO DA NFS-E", value: dateTime(text(inf, "dhProc")), col: 2 },
      ],
      [
        { label: "NÚMERO DA DPS", value: or(text(infDps, "nDPS")), col: 0 },
        { label: "SÉRIE DA DPS", value: or(text(infDps, "serie")), col: 1 },
        { label: "DATA E HORA DA EMISSÃO DA DPS", value: dateTime(text(infDps, "dhEmi")), col: 2 },
      ],
      [
        { label: "EMITENTE DA NFS-E", value: describe(TP_EMIT, text(infDps, "tpEmit")), col: 0, shaded: true },
        { label: "SITUAÇÃO DA NFS-E", value: describe(C_STAT, text(inf, "cStat")), col: 1 },
        { label: "FINALIDADE", value: describe(FIN_NFSE, text(infDps, "finNFSe")), col: 2 },
      ],
    ],
    blocks,
    serviceCodeDescription: or(text(cServ, "xTribMun") ?? text(inf, "xTribNac")),
    serviceDescription: or(text(cServ, "xDescServ")),
    complementaryInfo,
  };
}

/** Nota 10: the approximate-taxes line is mandatory. */
function approximateTaxes(totTrib: Node): string {
  const prefix = "Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012:";
  const pTotTribSN = text(totTrib, "pTotTribSN");
  if (pTotTribSN) return `${prefix} Simples Nacional: ${percent(pTotTribSN)}`;
  const value = child(totTrib, "vTotTrib");
  if (value) {
    return `${prefix} Federais: ${money(text(value, "vTotTribFed"))}; Estaduais: ${money(text(value, "vTotTribEst"))}; Municipais: ${money(text(value, "vTotTribMun"))}`;
  }
  const rate = child(totTrib, "pTotTrib");
  if (rate) {
    return `${prefix} Federais: ${percent(text(rate, "pTotTribFed"))}; Estaduais: ${percent(text(rate, "pTotTribEst"))}; Municipais: ${percent(text(rate, "pTotTribMun"))}`;
  }
  return `${prefix} Federais: ${EMPTY}; Estaduais: ${EMPTY}; Municipais: ${EMPTY}`;
}
