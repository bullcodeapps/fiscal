import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SefinError } from "../src/nfse";
import { interpretEmission, interpretEvent, interpretEventLookup } from "../src/nfse/sefin-client";

// Response bodies follow what Sefin produção restrita returned on 2026-10-26.
describe("interpretEmission", () => {
  it("decodes the authorized NFS-e", () => {
    const nfseXml = "<NFSe><infNFSe><nNFSe>1</nNFSe></infNFSe></NFSe>";
    const result = interpretEmission({
      status: 201,
      body: JSON.stringify({
        tipoAmbiente: 2,
        idDps: "DPS420820321122233300018100900000001793042430",
        chaveAcesso: "42082032211222333000181000000000000126104513068510",
        nfseXmlGZipB64: gzipSync(nfseXml).toString("base64"),
      }),
    });

    expect(result).toEqual({
      accessKey: "42082032211222333000181000000000000126104513068510",
      dpsId: "DPS420820321122233300018100900000001793042430",
      nfseXml,
      alerts: [],
    });
  });

  it.each([
    {
      scenario: "a business-rule rejection",
      status: 400,
      body: JSON.stringify({
        erros: [
          {
            Codigo: "E0322",
            Descricao: "É obrigatório informar na DPS um item da NBS se for declarada qualquer informação de IBS/CBS.",
          },
        ],
      }),
      kind: "rejected",
      codes: ["E0322"],
    },
    {
      scenario: "a gateway error page",
      status: 502,
      body: "<html>Bad Gateway</html>",
      kind: "unavailable",
      codes: [],
    },
    {
      // Sefin answered 500 for a 99.04.01 DPS before the code went live; the
      // DPS may or may not exist, so the caller must reconcile.
      scenario: "an internal server error",
      status: 500,
      body: "",
      kind: "unavailable",
      codes: [],
    },
  ])("classifies $scenario as $kind", ({ status, body, kind, codes }) => {
    let error: unknown;
    try {
      interpretEmission({ status, body });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(SefinError);
    expect((error as SefinError).kind).toBe(kind);
    expect((error as SefinError).messages.map((m) => m.code)).toEqual(codes);
  });

  // A 201 whose payload cannot be decoded is not an answer: the note may exist, so it must be reconciled.
  it.each([
    { scenario: "malformed gzip", payload: Buffer.from("not gzip").toString("base64") },
    { scenario: "a gzip bomb over 10 MB", payload: gzipSync(Buffer.alloc(11 * 1024 * 1024)).toString("base64") },
  ])("treats $scenario in an authorization as unavailable", ({ payload }) => {
    let error: unknown;
    try {
      interpretEmission({
        status: 201,
        body: JSON.stringify({ chaveAcesso: "42082032211222333000181000000000000126104513068510", nfseXmlGZipB64: payload }),
      });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(SefinError);
    expect((error as SefinError).kind).toBe("unavailable");
  });
});

describe("interpretEvent", () => {
  it("decodes the registered event", () => {
    const eventXml = "<evento><infEvento><nSeqEvento>1</nSeqEvento></infEvento></evento>";
    expect(
      interpretEvent({ status: 201, body: JSON.stringify({ eventoXmlGZipB64: gzipSync(eventXml).toString("base64") }) }),
    ).toBe(eventXml);
  });

  it("reads the lowercase `erro` object the event endpoint answers with", () => {
    let error: unknown;
    try {
      interpretEvent({
        status: 400,
        body: JSON.stringify({ erro: { codigo: "E0840", descricao: "Cancelamento já vinculado à NFS-e." } }),
      });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(SefinError);
    expect((error as SefinError).kind).toBe("rejected");
    expect((error as SefinError).messages).toEqual([
      { code: "E0840", description: "Cancelamento já vinculado à NFS-e." },
    ]);
  });
});

// GET /nfse/{chave}/eventos/{tipo}/{seq}: 200 carries the same body as the POST (EventosPostResponseSucesso),
// 404 means no such event (OpenAPI captured from produção restrita).
describe("interpretEventLookup", () => {
  it("decodes a registered event", () => {
    const eventXml = "<evento><infEvento/></evento>";
    expect(
      interpretEventLookup({ status: 200, body: JSON.stringify({ tipoAmbiente: 2, eventoXmlGZipB64: gzipSync(eventXml).toString("base64") }) }),
    ).toBe(eventXml);
  });

  it("returns null when the note has no such event", () => {
    expect(interpretEventLookup({ status: 404, body: JSON.stringify({ erro: { codigo: "E404", descricao: "Nenhum evento" } }) })).toBeNull();
  });

  // An unknown answer must never read as "no event": the caller would resend or revert a cancellation.
  it.each([
    { scenario: "a 200 without the event", response: { status: 200, body: "{}" } },
    { scenario: "a server error", response: { status: 502, body: "" } },
  ])("treats $scenario as unavailable", ({ response }) => {
    let error: unknown;
    try {
      interpretEventLookup(response);
    } catch (thrown) {
      error = thrown;
    }
    expect((error as SefinError).kind).toBe("unavailable");
  });
});
