import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { NFSE_LOGO_PNG } from "./logo";
import { buildDanfseModel, type DanfseBlock, type DanfseField } from "./model";

// Geometry from NT 008 item 2.4.5 (cm). Helvetica stands in for Arial and
// Microsoft Sans Serif: same metrics, and the only one pdfkit can embed
// without shipping licensed font files.
const CM = 72 / 2.54;
const PAGE_HEIGHT_CM = 29.7;
const MARGIN = 0.2;
const LEFT = 0.3;
const CONTENT_WIDTH = 20.4;
const COLUMNS = [0.3, 5.41, 10.51, 15.62];
const SPAN_WIDTH = [0, 5.09, 10.19, 15.3, 20.4];
const SHADE = "#F2F2F2"; // 5% gray
const RED = "#E30613";
const BOLD = "Helvetica-Bold";
const REGULAR = "Helvetica";
const MESSAGE_HEIGHT = 0.4;
const BOTTOM = PAGE_HEIGHT_CM - 0.3;

type Doc = InstanceType<typeof PDFDocument>;

const pt = (cm: number) => cm * CM;

function line(doc: Doc, y: number) {
  doc
    .lineWidth(0.5)
    .moveTo(pt(LEFT), pt(y))
    .lineTo(pt(LEFT + CONTENT_WIDTH), pt(y))
    .stroke("#000000");
}

function shade(doc: Doc, x: number, y: number, width: number, height: number) {
  doc.rect(pt(x), pt(y), pt(width), pt(height)).fill(SHADE).fillColor("#000000");
}

function write(
  doc: Doc,
  value: string,
  x: number,
  y: number,
  width: number,
  options: { font?: string; size?: number; color?: string; align?: "left" | "center" } = {},
) {
  doc
    .font(options.font ?? REGULAR)
    .fontSize(options.size ?? 7)
    .fillColor(options.color ?? "#000000")
    .text(value, pt(x) + 2, pt(y), {
      width: pt(width) - 4,
      // One line: pdfkit only applies the ellipsis once a height caps the box.
      height: (options.size ?? 7) * 1.2,
      ellipsis: true,
      align: options.align ?? "left",
    });
}

function field(doc: Doc, item: DanfseField, y: number, height: number, labelSize: number) {
  const x = COLUMNS[item.col];
  const width = SPAN_WIDTH[item.span ?? 1];
  if (item.shaded) shade(doc, x, y, width, height);
  write(doc, item.label, x, y + 0.08, width, { font: BOLD, size: labelSize });
  write(doc, item.value, x, y + 0.34, width);
}

function block(doc: Doc, item: DanfseBlock, top: number): number {
  line(doc, top);
  if (item.message) {
    shade(doc, LEFT, top, CONTENT_WIDTH, MESSAGE_HEIGHT);
    write(doc, item.message, LEFT, top + 0.12, CONTENT_WIDTH, { font: BOLD });
    return top + MESSAGE_HEIGHT;
  }
  shade(doc, COLUMNS[0], top, SPAN_WIDTH[1], item.rowHeight);
  write(doc, item.title, COLUMNS[0], top + 0.08, SPAN_WIDTH[1], { font: BOLD });
  item.rows.forEach((row, index) => {
    row.forEach((cell) => field(doc, cell, top + index * item.rowHeight, item.rowHeight, 6));
  });
  return top + Math.max(item.rows.length, 1) * item.rowHeight;
}

/**
 * DANFSe v2.0 (NT 008 v1.02, Anexo I) for an authorized NFS-e XML, one A4
 * page. The optional "canhoto" block is left out; its space goes to
 * "Informações Complementares" (item 2.3.3).
 */
export async function renderDanfse(nfseXml: string): Promise<Buffer> {
  const model = buildDanfseModel(nfseXml);
  const qrCode = await QRCode.toBuffer(model.qrCodeUrl, { margin: 0, width: 240, errorCorrectionLevel: "M" });

  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `DANFSe ${model.accessKey}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  // Header
  shade(doc, LEFT, 0.3, CONTENT_WIDTH, 1.16);
  doc.image(NFSE_LOGO_PNG, pt(0.49), pt(0.44), { fit: [pt(4), pt(0.85)] });
  write(doc, "DANFSe v2.0", 5.41, 0.4, 10.19, { font: BOLD, size: 9, align: "center" });
  write(doc, "Documento Auxiliar da NFS-e", 5.41, 0.75, 10.19, { font: BOLD, size: 9, align: "center" });
  if (model.withoutLegalValue) {
    write(doc, "NFS-e SEM VALIDADE JURÍDICA", 5.41, 1.1, 10.19, { font: BOLD, size: 9, color: RED, align: "center" });
  }
  write(doc, model.header.municipality, 15.62, 0.4, 5.09, { size: 8 });
  write(doc, model.header.generator, 15.62, 0.97, 5.09, { size: 6 });
  write(doc, model.header.environment, 15.62, 1.22, 5.09, { size: 6 });
  line(doc, 1.46);

  // Identification + QR code
  write(doc, "CHAVE DE ACESSO DA NFS-E", LEFT, 1.56, 15.3, { font: BOLD });
  write(doc, model.accessKey, LEFT, 1.86, 15.3);
  model.identification.forEach((row, index) => {
    row.forEach((cell) => field(doc, cell, 2.27 + index * 0.69, 0.67, 7));
  });
  doc.image(qrCode, pt(17.48), pt(1.67), { width: pt(1.52), height: pt(1.52) });
  doc
    .font(REGULAR)
    .fontSize(6)
    .fillColor("#000000")
    .text(
      "A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e",
      pt(15.8),
      pt(3.36),
      { width: pt(4.72), height: pt(0.9), ellipsis: true },
    );

  let y = 4.34;
  for (const item of model.blocks) {
    y = block(doc, item, y);
    if (item.title === "SERVIÇO PRESTADO") {
      write(doc, model.serviceCodeDescription, LEFT, y + 0.06, CONTENT_WIDTH, { color: "#555555" });
      y += 0.4;
      write(doc, "Descrição do Serviço", LEFT, y, CONTENT_WIDTH, { font: BOLD, size: 6 });
      doc.font(REGULAR).fontSize(7);
      const height = Math.min(
        Math.max(doc.heightOfString(model.serviceDescription, { width: pt(CONTENT_WIDTH) - 4 }) / CM, 0.4),
        3,
      );
      doc.text(model.serviceDescription, pt(LEFT) + 2, pt(y + 0.28), {
        width: pt(CONTENT_WIDTH) - 4,
        height: pt(height),
        ellipsis: true,
      });
      y += 0.28 + height + 0.1;
    }
  }

  // Informações complementares fill the rest of the page.
  line(doc, y);
  write(doc, "INFORMAÇÕES COMPLEMENTARES", LEFT, y + 0.08, CONTENT_WIDTH, { font: BOLD });
  doc
    .font(REGULAR)
    .fontSize(7)
    .fillColor("#000000")
    .text(model.complementaryInfo.join(" | "), pt(LEFT) + 2, pt(y + 0.4), {
      width: pt(CONTENT_WIDTH) - 4,
      height: Math.max(pt(BOTTOM - y - 0.5), 0),
      ellipsis: true,
    });

  doc
    .lineWidth(1)
    .rect(pt(MARGIN), pt(MARGIN), pt(21 - 2 * MARGIN), pt(PAGE_HEIGHT_CM - 2 * MARGIN))
    .stroke("#000000");
  doc.end();
  return done;
}
