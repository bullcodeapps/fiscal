import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCertificate } from "../src";
import {
  buildDanfseModel,
  buildDps,
  isNfseOfDps,
  readNfseEventSummary,
  readNfseSummary,
  renderDanfse,
  signDps,
  type DpsInput,
} from "../src/nfse";
import { makePfx } from "./make-pfx";

const dpsInput: DpsInput = {
  environment: "restricted",
  dhEmi: new Date("2026-10-26T19:20:30Z"),
  dCompet: "2026-10-26",
  serie: "00900",
  nDPS: "1",
  cLocEmi: "4208203",
  verAplic: "fiscal-test-1",
  prest: { CNPJ: "11222333000181", regTrib: { opSimpNac: 3, regApTribSN: 1, regEspTrib: 0 } },
  serv: { cLocPrestacao: "4208203", cTribNac: "170303", cNBS: "114012900", xDescServ: "x" },
  valores: { vServ: 10, tribISSQN: 1, tpRetISSQN: 1, totTrib: { pTotTribSN: 6 } },
};

// NFS-e 1 and 2 authorized by Sefin produção restrita on 2026-10-26.
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}.xml`, import.meta.url), "utf8");

const fieldValues = (model: ReturnType<typeof buildDanfseModel>, title: string) =>
  Object.fromEntries(
    model.blocks
      .find((block) => block.title === title)!
      .rows.flat()
      .map((field) => [field.label, field.value]),
  );

describe("buildDanfseModel", () => {
  const rental = buildDanfseModel(fixture("nfse-990401"));

  it("identifies the note and flags the test environment", () => {
    expect(rental.accessKey).toBe("42082032211222333000181000000000000226100953785610");
    expect(rental.qrCodeUrl).toBe(
      "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=42082032211222333000181000000000000226100953785610",
    );
    expect(rental.withoutLegalValue).toBe(true);
    // NT 008: no municipality in the header when the national code's item is 99.
    expect(rental.header.municipality).toBeNull();
    expect(Object.fromEntries(rental.identification.flat().map((f) => [f.label, f.value]))).toEqual({
      "NÚMERO DA NFS-E": "2",
      "COMPETÊNCIA DA NFS-E": "26/10/2026",
      "DATA E HORA DA EMISSÃO DA NFS-E": "26/10/2026 16:21:03",
      "NÚMERO DA DPS": "1793042463",
      "SÉRIE DA DPS": "00900",
      "DATA E HORA DA EMISSÃO DA DPS": "26/10/2026 16:21:03",
      "EMITENTE DA NFS-E": "Prestador",
      "SITUAÇÃO DA NFS-E": "NFS-e Gerada",
      FINALIDADE: "NFS-e regular",
    });
  });

  it("masks documents and resolves IBGE cities for the parties", () => {
    expect(fieldValues(rental, "PRESTADOR / FORNECEDOR")).toMatchObject({
      "CNPJ / CPF / NIF": "11.222.333/0001-81",
      "Município / Sigla UF": "Itajaí / SC",
      "Código IBGE / CEP": "4208203 / 88.300-000",
      "Simples Nacional na Data de Competência": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)",
    });
    expect(fieldValues(rental, "TOMADOR / ADQUIRENTE")).toMatchObject({
      "CNPJ / CPF / NIF": "00.000.000/0001-91",
      "Município / Sigla UF": "Brasília / DF",
      "Código IBGE / CEP": "5300108 / 70.040-912",
      Endereço: "SAUN QUADRA 5 LOTE B, SN, ASA NORTE",
      Telefone: "-",
    });
  });

  it("collapses the blocks the NT lets go and fills the IBS/CBS and totals", () => {
    const messages = Object.fromEntries(
      rental.blocks.filter((b) => b.message).map((b) => [b.title, b.message]),
    );
    expect(messages).toEqual({
      "DESTINATÁRIO DA OPERAÇÃO": "O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO",
      "INTERMEDIÁRIO DA OPERAÇÃO": "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e",
      "TRIBUTAÇÃO MUNICIPAL (ISSQN)": "TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN",
    });
    expect(fieldValues(rental, "SERVIÇO PRESTADO")).toEqual({
      "Código de Tributação Nacional / Municipal": "99.04.01 / -",
      "Código da NBS": "1.1101.15.00",
      "Local da Prestação / Sigla UF / País": "Itajaí / SC / BR",
    });
    expect(fieldValues(rental, "TRIBUTAÇÃO IBS / CBS")).toMatchObject({
      "CST / cClassTrib": "000 / 000001",
      "Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF":
        "100301 / 5300108 / Brasília / DF",
      "Valor Total Apurado - IBS": "R$ 0,01",
      "Alíquota - CBS": "0,90%",
      "Valor Total Apurado - CBS": "R$ 0,09",
    });
    expect(fieldValues(rental, "VALOR TOTAL DA NFS-E")).toMatchObject({
      "VALOR DA OPERAÇÃO / SERVIÇO": "R$ 10,00",
      "Total do IBS/CBS": "R$ 0,10",
      "VALOR LÍQUIDO DA NFS-e + IBS/CBS": "R$ 10,00",
    });
    expect(rental.serviceCodeDescription).toBe("Locação de Bens Móveis");
    expect(rental.complementaryInfo).toEqual([
      "Bem Móvel: NCM 89039900 - JET SKI SEA-DOO WAKE PRO 230 (1)",
      "Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Simples Nacional: 6,00%",
    ]);
  });

  it("shows the issuing municipality as NT 008 formats it", () => {
    expect(buildDanfseModel(fixture("nfse-170303")).header.municipality).toBe("Município: Itajaí / SC");
  });

  // NT 008 2.5: a cancelled or substituted note must carry the watermark, or it reads as valid.
  it.each([
    [undefined, null],
    [{ situation: "cancelled" as const }, "CANCELADA"],
    [{ situation: "substituted" as const }, "SUBSTITUÍDA"],
  ])("sets the watermark for %o", (options, watermark) => {
    expect(buildDanfseModel(fixture("nfse-170303"), options).watermark).toBe(watermark);
  });

  it("lists the construction and event identifiers NT 008 requires in the complementary information", () => {
    const xml = fixture("nfse-170303").replace(
      "</cServ></serv>",
      "</cServ><obra><inscImobFisc>IMOB1</inscImobFisc><cObra>OBRA1</cObra></obra><atvEvento><idAtvEvt>EVT1</idAtvEvt></atvEvento></serv>",
    );
    expect(buildDanfseModel(xml).complementaryInfo).toEqual(
      expect.arrayContaining(["Cod. Obra: OBRA1", "Insc. Imob.: IMOB1", "Cod. Evt.: EVT1"]),
    );
  });

  it("describes a MEI note's status instead of printing its code", () => {
    const xml = fixture("nfse-170303").replace("<cStat>100</cStat>", "<cStat>107</cStat>");
    expect(buildDanfseModel(xml).identification.flat().find((f) => f.label === "SITUAÇÃO DA NFS-E")?.value).toBe("NFS-e MEI");
  });

  it("keeps the ISSQN block for a taxable service and drops its empty benefit row", () => {
    const management = buildDanfseModel(fixture("nfse-170303"));
    const issqn = management.blocks.find((b) => b.title === "TRIBUTAÇÃO MUNICIPAL (ISSQN)")!;

    expect(issqn.message).toBeUndefined();
    expect(issqn.rows.map((row) => row[0].label)).toEqual([
      "Tipo de Tributação do ISSQN",
      "Regime Especial de Tributação do ISSQN",
      "BC ISSQN",
    ]);
    expect(fieldValues(management, "TRIBUTAÇÃO MUNICIPAL (ISSQN)")).toMatchObject({
      "Tipo de Tributação do ISSQN": "Operação Tributável",
      "Município / Sigla UF / País de Incidência do ISSQN": "Itajaí / SC / BR",
      "Retenção do ISSQN": "Não Retido",
    });
  });

  it("shows the NIF and the foreign city and country once for an export note", () => {
    const foreignTaker =
      "<toma><NIF>98-7654321</NIF><xNome>ACME INC</xNome><end><endExt><cPais>US</cPais><cEndPost>94105</cEndPost>" +
      "<xCidade>San Francisco</xCidade><xEstProvReg>CA</xEstProvReg></endExt>" +
      "<xLgr>Market St</xLgr><nro>1</nro><xBairro>SoMa</xBairro></end></toma>";
    const xml = fixture("nfse-170303").replace(/<toma>.*<\/toma>/, foreignTaker);

    expect(fieldValues(buildDanfseModel(xml), "TOMADOR / ADQUIRENTE")).toMatchObject({
      "CNPJ / CPF / NIF": "98-7654321",
      "Cidade / Estado": "San Francisco / CA",
      "País / Código Postal": "US / 94105",
      Endereço: "Market St, 1, SoMa",
    });
  });

  it.each([
    { dCompet: "2026-12-31", rows: 2 },
    { dCompet: "2027-01-05", rows: 1 },
  ])("prints the PIS/COFINS line only up to 2026 (competence $dCompet)", ({ dCompet, rows }) => {
    const xml = fixture("nfse-170303").replace(/<dCompet>[^<]+</, `<dCompet>${dCompet}<`);
    const federal = buildDanfseModel(xml).blocks.find((b) => b.title === "TRIBUTAÇÃO FEDERAL (EXCETO CBS)")!;

    expect(federal.rows).toHaveLength(rows);
  });

  // NT 008: the place shows cPaisPrestacao, and the ISSQN incidence shows cPaisResult, instead of BR.
  it("shows the country of a service performed abroad", () => {
    const abroad = fixture("nfse-990401")
      .replace("<xLocPrestacao>Itajaí</xLocPrestacao>", "")
      .replace("<locPrest><cLocPrestacao>4208203</cLocPrestacao></locPrest>", "<locPrest><cPaisPrestacao>US</cPaisPrestacao></locPrest>");
    expect(fieldValues(buildDanfseModel(abroad), "SERVIÇO PRESTADO")["Local da Prestação / Sigla UF / País"]).toBe("- / - / US");
  });

  it("shows the country of the result as the ISSQN incidence of an export", () => {
    const exported = fixture("nfse-170303")
      .replace("<xLocIncid>Itajaí</xLocIncid>", "")
      .replace("<tribISSQN>1</tribISSQN>", "<tribISSQN>3</tribISSQN><cPaisResult>US</cPaisResult>");
    expect(
      fieldValues(buildDanfseModel(exported), "TRIBUTAÇÃO MUNICIPAL (ISSQN)")["Município / Sigla UF / País de Incidência do ISSQN"],
    ).toBe("- / - / US");
  });

  it("reads finNFSe and the IBS/CBS situation from the production layout", () => {
    // Produção nests finNFSe in IBSCBS and CST/cClassTrib in gIBSCBS (nfse-esquemas_xsd-v1-01-20260209).
    const production = fixture("nfse-990401")
      .replace("</tpEmit><finNFSe>0</finNFSe>", "</tpEmit>")
      .replace("<IBSCBS><indFinal>", "<IBSCBS><finNFSe>0</finNFSe><indFinal>")
      .replace(/<trib>(<CST>\d+<\/CST><cClassTrib>\d+<\/cClassTrib>)<\/trib>/, "<trib><gIBSCBS>$1</gIBSCBS></trib>");
    expect(production).toContain("<gIBSCBS>");
    const model = buildDanfseModel(production);

    expect(model.identification.flat().find((f) => f.label === "FINALIDADE")?.value).toBe("NFS-e regular");
    expect(fieldValues(model, "TRIBUTAÇÃO IBS / CBS")["CST / cClassTrib"]).toBe("000 / 000001");
  });
});

describe("renderDanfse", () => {
  it("draws the note on a single A4 page", async () => {
    const pdf = await renderDanfse(fixture("nfse-990401"));
    const content = pdf.toString("latin1");

    expect(content.startsWith("%PDF-")).toBe(true);
    expect(content.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(1);
    expect(content).toContain("/MediaBox [0 0 595.28 841.89]");
  });

  it("keeps a cancelled note on one page with its watermark", async () => {
    const plain = (await renderDanfse(fixture("nfse-990401"))).toString("latin1");
    const pdf = (await renderDanfse(fixture("nfse-990401"), { situation: "cancelled" })).toString("latin1");
    expect(pdf.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(1);
    // Only the watermark is translucent: its graphics state is the observable sign it was drawn.
    expect(plain).not.toContain("/ca 0.6");
    expect(pdf).toContain("/ca 0.6");
  });
});

describe("readNfseSummary", () => {
  it("reads what an adoption check and the ADN import use from the note", async () => {
    const { readNfseSummary } = await import("../src/nfse");
    expect(readNfseSummary(fixture("nfse-990401"))).toEqual({
      accessKey: "42082032211222333000181000000000000226100953785610",
      number: "2",
      takerDocument: "00000000000191",
      serviceValueCents: 1000,
      competenceDate: "2026-10-26",
      description: "TESTE HOMOLOGACAO NT009 d",
      providerDocument: "11222333000181",
      takerName: "BANCO DO BRASIL SA",
      takerNif: null,
      issuedAt: "2026-10-26T16:21:03-03:00",
      dpsId: "DPS420820321122233300018100900000001793042463",
      issqnCents: 0,
      issqnInSimples: true,
    });
  });
});

describe("malformed XML", () => {
  // A truncated note must fail loudly, not become an empty summary that an import would store.
  it.each([
    ["readNfseSummary", () => readNfseSummary("<NFSe><infNFSe>")],
    ["readNfseSummary without a note", () => readNfseSummary("<evento/>")],
    ["buildDanfseModel", () => buildDanfseModel("<NFSe><infNFSe>")],
    ["readNfseEventSummary", () => readNfseEventSummary("<evento><infEvento>")],
  ])("%s throws", (_name, call) => {
    expect(call).toThrow();
  });
});

describe("isNfseOfDps", () => {
  // After E0014 or a timeout, the note found by DPS Id must be the DPS this row signed, not
  // another invoice that reused the same number.
  const certificate = loadCertificate(makePfx({ password: "x", cnpj: "11222333000181" }), "x");
  const signed = (xDescServ: string) =>
    signDps(buildDps({ ...dpsInput, serv: { ...dpsInput.serv, xDescServ } }).xml, certificate);
  const nfseWith = (signedDpsXml: string) =>
    '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS1"><nNFSe>1</nNFSe>' +
    signedDpsXml.replace(/^<\?xml[^>]*>/, "") +
    "</infNFSe></NFSe>";

  it("is true for the note that embeds this signed DPS", () => {
    const dps = signed("Servico de março");
    expect(isNfseOfDps(nfseWith(dps), dps)).toBe(true);
  });

  it("is false for a note with the same DPS Id but other content", () => {
    expect(isNfseOfDps(nfseWith(signed("Servico de março")), signed("Servico de abril"))).toBe(false);
  });
});

describe("readNfseEventSummary", () => {
  const KEY = "42082032211222333000181000000000000226100953785610";
  const request = (code: string) => `<pedRegEvento><infPedReg><chNFSe>${KEY}</chNFSe><e${code}/></infPedReg></pedRegEvento>`;

  // The ADN validates evento/infEvento/pedRegEvento; the summary must read that same request.
  it("reads the registered request, not another infPedReg in the document", () => {
    const xml = `<evento><infEvento><x><infPedReg><chNFSe>${KEY}</chNFSe><e105102/></infPedReg></x><nSeqEvento>1</nSeqEvento>${request("101101")}</infEvento></evento>`;
    expect(readNfseEventSummary(xml)).toEqual({ accessKey: KEY, code: "101101" });
  });

  it("returns no code for a bare request, which proves nothing", () => {
    expect(readNfseEventSummary(request("101101")).code).toBeNull();
  });

  it("reads the note and the event code from a distributed cancellation", async () => {
    const { readNfseEventSummary } = await import("../src/nfse");
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">' +
      '<infEvento Id="EVT42082032211222333000181000000000000226100953785610101101001"><nSeqEvento>1</nSeqEvento>' +
      '<pedRegEvento versao="1.01"><infPedReg Id="PRE42082032211222333000181000000000000226100953785610101101">' +
      "<tpAmb>2</tpAmb><verAplic>x</verAplic><dhEvento>2026-10-27T10:00:00-03:00</dhEvento><CNPJAutor>11222333000181</CNPJAutor>" +
      "<chNFSe>42082032211222333000181000000000000226100953785610</chNFSe><nPedRegEvento>001</nPedRegEvento>" +
      "<e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>Erro na emissao</xMotivo></e101101>" +
      "</infPedReg></pedRegEvento></infEvento></evento>";
    expect(readNfseEventSummary(xml)).toEqual({
      accessKey: "42082032211222333000181000000000000226100953785610",
      code: "101101",
    });
  });
});
