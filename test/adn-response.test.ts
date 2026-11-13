import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { AdnError } from "../src/nfse";
import { interpretDistribution } from "../src/nfse/adn-client";

// Body shape of GET /contribuintes/DFe/{NSU}?lote=true (LoteDistribuicaoNSUResponse).
describe("interpretDistribution", () => {
  it("decodes every document of a page", () => {
    const nfseXml = "<NFSe><infNFSe><nNFSe>118</nNFSe></infNFSe></NFSe>";
    const eventXml = "<evento><infEvento/></evento>";
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
      { nsu: 8, accessKey: null, type: "EVENTO", xml: eventXml },
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
});
