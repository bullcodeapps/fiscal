import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDanfseModel, renderDanfse } from "../src/nfse";

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
    expect(rental.header.municipality).toBe("Município: Itajaí - SC");
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
});

describe("renderDanfse", () => {
  it("draws the note on a single A4 page", async () => {
    const pdf = await renderDanfse(fixture("nfse-990401"));
    const content = pdf.toString("latin1");

    expect(content.startsWith("%PDF-")).toBe(true);
    expect(content.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(1);
    expect(content).toContain("/MediaBox [0 0 595.28 841.89]");
  });
});

describe("readNfseSummary", () => {
  it("reads what an adoption check compares (key, number, taker, value, competence, description)", async () => {
    const { readNfseSummary } = await import("../src/nfse");
    expect(readNfseSummary(fixture("nfse-990401"))).toEqual({
      accessKey: "42082032211222333000181000000000000226100953785610",
      number: "2",
      takerDocument: "00000000000191",
      serviceValueCents: 1000,
      competenceDate: "2026-10-26",
      description: "TESTE HOMOLOGACAO NT009 d",
    });
  });
});
