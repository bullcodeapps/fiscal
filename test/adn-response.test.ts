import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { AdnError } from "../src/nfse";
import { interpretDistribution } from "../src/nfse/adn-client";

const EVENT_KEY = "42082032211222333000181000000000000226100953785610";
const request = (key: string) =>
  `<pedRegEvento><infPedReg><chNFSe>${key}</chNFSe><nPedRegEvento>001</nPedRegEvento><e101101><cMotivo>1</cMotivo></e101101></infPedReg></pedRegEvento>`;
const registeredEvent = (key: string) => `<evento><infEvento><nSeqEvento>1</nSeqEvento>${request(key)}</infEvento></evento>`;

// Body shape of GET /contribuintes/DFe/{NSU}?lote=true (LoteDistribuicaoNSUResponse).
describe("interpretDistribution", () => {
  it("decodes every document of a page", () => {
    const nfseXml = '<NFSe><infNFSe Id="NFS42082031211222333000181000000000011826060000000016"><nNFSe>118</nNFSe></infNFSe></NFSe>';
    const eventXml = registeredEvent(EVENT_KEY);
    const documents = interpretDistribution({
      status: 200,
      body: JSON.stringify({
        StatusProcessamento: "DOCUMENTOS_LOCALIZADOS",
        LoteDFe: [
          { NSU: 7, ChaveAcesso: "42082031211222333000181000000000011826060000000016", TipoDocumento: "NFSE", ArquivoXml: gzipSync(nfseXml).toString("base64") },
          { NSU: "8", ChaveAcesso: null, TipoDocumento: "EVENTO", ArquivoXml: gzipSync(eventXml).toString("base64") },
        ],
      }),
    });

    expect(documents).toEqual([
      { nsu: 7, accessKey: "42082031211222333000181000000000011826060000000016", type: "NFSE", xml: nfseXml },
      { nsu: 8, accessKey: EVENT_KEY, type: "EVENTO", xml: eventXml },
    ]);
  });

  it("returns no documents when the queue is empty (HTTP 404)", () => {
    const body = JSON.stringify({ StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO", LoteDFe: null });
    expect(interpretDistribution({ status: 404, body })).toEqual([]);
  });

  it.each([
    {
      scenario: "a rejection",
      status: 400,
      body: JSON.stringify({ StatusProcessamento: "REJEICAO", Erros: [{ Codigo: "E1", Descricao: "Certificado não autorizado" }] }),
      kind: "rejected",
      message: "E1: Certificado não autorizado",
    },
    { scenario: "too many requests", status: 429, body: "", kind: "rate_limited", message: "ADN indisponível (HTTP 429)" },
    { scenario: "a gateway error page", status: 502, body: "<html>Bad Gateway</html>", kind: "unavailable", message: "ADN indisponível (HTTP 502)" },
  ])("throws $kind for $scenario", ({ status, body, kind, message }) => {
    let error: unknown;
    try {
      interpretDistribution({ status, body });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AdnError);
    expect(error).toMatchObject({ kind, message, httpStatus: status });
  });

  it("treats a document that cannot be decoded as unavailable, so the cursor does not move past it", () => {
    let error: unknown;
    try {
      interpretDistribution({
        status: 200,
        body: JSON.stringify({
          StatusProcessamento: "DOCUMENTOS_LOCALIZADOS",
          LoteDFe: [{ NSU: 9, ChaveAcesso: null, TipoDocumento: "NFSE", ArquivoXml: "bm90IGd6aXA=" }],
        }),
      });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(AdnError);
    expect((error as AdnError).kind).toBe("unavailable");
  });

  const page = (docs: unknown[]) => ({
    status: 200,
    body: JSON.stringify({ StatusProcessamento: "DOCUMENTOS_LOCALIZADOS", LoteDFe: docs }),
  });
  const gz = (bytes: number) => gzipSync(Buffer.alloc(bytes)).toString("base64");
  const nonCanonical = (xml: string) => {
    let b64 = gzipSync(xml).toString("base64");
    for (let pad = 0; !b64.endsWith("=="); pad++) b64 = gzipSync(xml + " ".repeat(pad)).toString("base64");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const last = alphabet.indexOf(b64[b64.length - 3]);
    return `${b64.slice(0, -3)}${alphabet[last ^ 1]}==`;
  };

  it.each([
    // Each document is under the cap; together they would inflate a small body into memory.
    { scenario: "a page above 10 MB once decompressed", docs: [1, 2, 3].map((nsu) => ({ NSU: nsu, TipoDocumento: "NFSE", ArquivoXml: gz(4 * 1024 * 1024) })) },
    { scenario: "an NSU that is not a positive integer", docs: [{ NSU: "abc", TipoDocumento: "NFSE", ArquivoXml: gz(10) }] },
    { scenario: "base64 with characters outside the alphabet", docs: [{ NSU: 1, TipoDocumento: "NFSE", ArquivoXml: `${gz(10)}!!` }] },
    // The ADN sends at most 50 per page; more tiny entries would cost a gunzip call each.
    { scenario: "a page of more than 50 documents", docs: Array.from({ length: 51 }, (_, i) => ({ NSU: i + 1, TipoDocumento: "EVENTO", ArquivoXml: gzipSync(registeredEvent(EVENT_KEY)).toString("base64") })) },
    // With two event groups the code depends on element order: cancelled or substituted.
    {
      scenario: "an event with two event groups",
      docs: [{ NSU: 1, TipoDocumento: "EVENTO", ArquivoXml: gzipSync(registeredEvent(EVENT_KEY).replace("<e101101>", "<e105102/><e101101>")).toString("base64") }],
    },
    // Unused trailing bits decode to the same bytes, so "strict" must mean canonical.
    { scenario: "non-canonical base64", docs: [{ NSU: 1, TipoDocumento: "EVENTO", ArquivoXml: nonCanonical(registeredEvent(EVENT_KEY)) }] },
    { scenario: "a page entry that is not an object", docs: [null] },
    // Without its type an NFS-e would be handled as an event and skipped for good.
    { scenario: "a document without its type", docs: [{ NSU: 1, ArquivoXml: gz(10) }] },
    // A crash between two out-of-order documents would move the cursor past the lower one.
    { scenario: "NSUs out of order", docs: [2, 1].map((nsu) => ({ NSU: nsu, TipoDocumento: "EVENTO", ArquivoXml: gz(10) })) },
    // Number("1e9") is a safe integer: the cursor would jump past every document in between.
    { scenario: "an NSU in exponent notation", docs: [{ NSU: "1e9", TipoDocumento: "EVENTO", ArquivoXml: gzipSync(registeredEvent(EVENT_KEY)).toString("base64") }] },
    // A bare request is not a registered event: importing it would cancel a note that was never cancelled.
    { scenario: "an event that is only the request", docs: [{ NSU: 1, TipoDocumento: "EVENTO", ArquivoXml: gzipSync(request(EVENT_KEY)).toString("base64") }] },
    // The parser reads truncated XML without complaint; the cursor must not move past it.
    { scenario: "a truncated NFS-e", docs: [{ NSU: 1, TipoDocumento: "NFSE", ArquivoXml: gzipSync(`<NFSe><infNFSe Id="NFS${EVENT_KEY}"><nNFSe>1`).toString("base64") }] },
    { scenario: "a truncated event", docs: [{ NSU: 1, TipoDocumento: "EVENTO", ArquivoXml: gzipSync(registeredEvent(EVENT_KEY).slice(0, -20)).toString("base64") }] },
    {
      scenario: "a malformed envelope key",
      docs: [{ NSU: 1, TipoDocumento: "NFSE", ChaveAcesso: "BAD", ArquivoXml: gzipSync(`<NFSe><infNFSe Id="NFS${EVENT_KEY}"/></NFSe>`).toString("base64") }],
    },
    {
      // The importer updates the note the event names; it must be the note the envelope names.
      scenario: "an event whose envelope key is not the one in its XML",
      docs: [{ NSU: 1, TipoDocumento: "EVENTO", ChaveAcesso: "4".repeat(50), ArquivoXml: gzipSync(registeredEvent(EVENT_KEY)).toString("base64") }],
    },
    {
      // The key decides which stored note an import updates.
      scenario: "an NFS-e whose envelope key is not the one in its XML",
      docs: [{ NSU: 1, TipoDocumento: "NFSE", ChaveAcesso: "4".repeat(50), ArquivoXml: gzipSync(`<NFSe><infNFSe Id="NFS${"5".repeat(50)}"/></NFSe>`).toString("base64") }],
    },
  ])("treats $scenario as unavailable", ({ docs }) => {
    let error: unknown;
    try {
      interpretDistribution(page(docs));
    } catch (thrown) {
      error = thrown;
    }
    expect((error as AdnError).kind).toBe("unavailable");
  });

  // A server error is retried; only a 4xx rejection stops the importer for a person to look at.
  it("treats a rejection status on a server error as unavailable", () => {
    let error: unknown;
    try {
      interpretDistribution({ status: 500, body: JSON.stringify({ StatusProcessamento: "REJEICAO", Erros: [] }) });
    } catch (thrown) {
      error = thrown;
    }
    expect((error as AdnError).kind).toBe("unavailable");
  });

  // An outage must not read as a drained queue: the importer would then wait an hour.
  it("treats an empty-queue status on a server error as unavailable", () => {
    let error: unknown;
    try {
      interpretDistribution({ status: 500, body: JSON.stringify({ StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO" }) });
    } catch (thrown) {
      error = thrown;
    }
    expect((error as AdnError).kind).toBe("unavailable");
  });

  it("treats a found-documents status without a document list as unavailable", () => {
    let error: unknown;
    try {
      interpretDistribution({ status: 200, body: JSON.stringify({ StatusProcessamento: "DOCUMENTOS_LOCALIZADOS" }) });
    } catch (thrown) {
      error = thrown;
    }
    expect((error as AdnError).kind).toBe("unavailable");
  });

  it("takes an NFS-e key from its XML when the envelope has none", () => {
    const key = "5".repeat(50);
    const [doc] = interpretDistribution(
      page([{ NSU: 1, TipoDocumento: "NFSE", ChaveAcesso: null, ArquivoXml: gzipSync(`<NFSe><infNFSe Id="NFS${key}"/></NFSe>`).toString("base64") }]),
    );
    expect(doc.accessKey).toBe(key);
  });
});

