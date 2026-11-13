import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SefinError } from "../src/nfse";
import {
  interpretDpsLookup,
  interpretEmission,
  interpretEvent,
  interpretEventLookup,
  interpretNfseLookup,
} from "../src/nfse/sefin-client";

// Response bodies follow what Sefin produção restrita returned on 2026-10-26.
const KEY = "42082032211222333000181000000000000126104513068510";
const eventXmlFor = (accessKey: string, type = "101101") =>
  `<evento><infEvento Id="EVT${accessKey}${type}001"><nSeqEvento>1</nSeqEvento><pedRegEvento><infPedReg Id="PRE${accessKey}${type}">` +
  `<chNFSe>${accessKey}</chNFSe><e${type}><cMotivo>1</cMotivo></e${type}></infPedReg></pedRegEvento></infEvento></evento>`;
const gz = (xml: string) => gzipSync(xml).toString("base64");
const expectUnavailable = (call: () => unknown) => {
  let error: unknown;
  try {
    call();
  } catch (thrown) {
    error = thrown;
  }
  expect(error).toBeInstanceOf(SefinError);
  expect((error as SefinError).kind).toBe("unavailable");
};
describe("interpretEmission", () => {
  it("decodes the authorized NFS-e", () => {
    const nfseXml = `<NFSe><infNFSe Id="NFS${KEY}"><nNFSe>1</nNFSe></infNFSe></NFSe>`;
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
    const eventXml = eventXmlFor(KEY);
    expect(interpretEvent({ status: 201, body: JSON.stringify({ eventoXmlGZipB64: gz(eventXml) }) }, { accessKey: KEY, type: "101101" })).toBe(
      eventXml,
    );
  });

  // A success that is not the requested event must not be stored as proof of a cancellation.
  it.each([
    { scenario: "XML that is not well formed", xml: "<evento><infEvento>" },
    { scenario: "an event of another note", xml: eventXmlFor("4208203221122233300018100000000000012610451306851X".replace("X", "9")) },
    { scenario: "another event type", xml: eventXmlFor(KEY, "105102") },
    // Only a request inside infEvento was registered; one beside an empty infEvento proves nothing.
    {
      scenario: "a request outside infEvento",
      xml: `<evento><infEvento/><nSeqEvento>1</nSeqEvento><pedRegEvento><infPedReg><chNFSe>${KEY}</chNFSe><e101101/></infPedReg></pedRegEvento></evento>`,
    },
  ])("treats $scenario as unavailable", ({ xml }) => {
    expectUnavailable(() => interpretEvent({ status: 201, body: JSON.stringify({ eventoXmlGZipB64: gz(xml) }) }, { accessKey: KEY, type: "101101" }));
  });

  it("reads the lowercase `erro` object the event endpoint answers with", () => {
    let error: unknown;
    try {
      interpretEvent(
        { status: 400, body: JSON.stringify({ erro: { codigo: "E0840", descricao: "Cancelamento já vinculado à NFS-e." } }) },
        { accessKey: KEY, type: "101101" },
      );
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
  const expected = { accessKey: KEY, type: "101101" };

  it("decodes the requested event", () => {
    const eventXml = eventXmlFor(KEY);
    expect(interpretEventLookup({ status: 200, body: JSON.stringify({ tipoAmbiente: 2, eventoXmlGZipB64: gz(eventXml) }) }, expected)).toBe(
      eventXml,
    );
  });

  it("returns null when Sefin answers that the note has no such event", () => {
    expect(
      interpretEventLookup({ status: 404, body: JSON.stringify({ erro: { codigo: "E404", descricao: "Nenhum evento" } }) }, expected),
    ).toBeNull();
  });

  // An unknown answer must never read as "no event": the caller would resend or revert a cancellation.
  it.each([
    { scenario: "a 404 page from a gateway", response: { status: 404, body: "<html>Not Found</html>" } },
    { scenario: "a JSON 404 from a gateway", response: { status: 404, body: JSON.stringify({ message: "Not Found" }) } },
    { scenario: "the cancellation request instead of the registered event", response: { status: 200, body: JSON.stringify({ eventoXmlGZipB64: gz(eventXmlFor(KEY).replace(/^<evento><infEvento[^>]*><nSeqEvento>1<\/nSeqEvento>/, "").replace("</infEvento></evento>", "")) }) } },
    { scenario: "a 200 without the event", response: { status: 200, body: "{}" } },
    { scenario: "a 200 with another note's event", response: { status: 200, body: JSON.stringify({ eventoXmlGZipB64: gz(eventXmlFor(KEY, "105102")) }) } },
    { scenario: "a server error", response: { status: 502, body: "" } },
  ])("treats $scenario as unavailable", ({ response }) => {
    expectUnavailable(() => interpretEventLookup(response, expected));
  });
});

describe("malformed bodies", () => {
  it("treats an error list with non-object members as unavailable", () => {
    expectUnavailable(() => interpretEmission({ status: 500, body: JSON.stringify({ erros: [null, 7] }) }));
  });

  it("treats an authorized note that is not well-formed XML as unavailable", () => {
    expectUnavailable(() =>
      interpretEmission({ status: 201, body: JSON.stringify({ chaveAcesso: KEY, nfseXmlGZipB64: gz("<NFSe><infNFSe>") }) }),
    );
  });
});

describe("access key identity", () => {
  const nfse = (key: string) => gz(`<NFSe><infNFSe Id="NFS${key}"><nNFSe>1</nNFSe></infNFSe></NFSe>`);
  const OTHER = "42082032211222333000181000000000000126104513068519";

  // The stored key drives every later lookup and the cancellation; it must be the note's own.
  it.each([
    { scenario: "a key that is not the note's", body: { chaveAcesso: OTHER, nfseXmlGZipB64: nfse(KEY) } },
    { scenario: "a malformed key", body: { chaveAcesso: "junk", nfseXmlGZipB64: nfse("junk") } },
    // A key in a comment is not the note's Id: the real infNFSe names another note.
    {
      scenario: "the announced key only in a comment",
      body: { chaveAcesso: KEY, nfseXmlGZipB64: gz(`<NFSe><!-- <infNFSe Id="NFS${KEY}"> --><infNFSe Id="NFS${OTHER}"><nNFSe>1</nNFSe></infNFSe></NFSe>`) },
    },
    {
      scenario: "XML that is not valid UTF-8",
      body: { chaveAcesso: KEY, nfseXmlGZipB64: gzipSync(Buffer.concat([Buffer.from(`<NFSe><infNFSe Id="NFS${KEY}"><x>`), Buffer.from([0xff]), Buffer.from("</x></infNFSe></NFSe>")])).toString("base64") },
    },
  ])("treats an authorization with $scenario as unavailable", ({ body }) => {
    expectUnavailable(() => interpretEmission({ status: 201, body: JSON.stringify(body) }));
  });

  it("treats a looked-up note of another key as unavailable", () => {
    expectUnavailable(() => interpretNfseLookup({ status: 200, body: JSON.stringify({ nfseXmlGZipB64: nfse(OTHER) }) }, KEY));
  });

  it("returns the looked-up note when it carries the requested key", () => {
    expect(interpretNfseLookup({ status: 200, body: JSON.stringify({ nfseXmlGZipB64: nfse(KEY) }) }, KEY)).toContain(`NFS${KEY}`);
  });

  it("treats a DPS lookup answering a malformed key as unavailable", () => {
    expectUnavailable(() => interpretDpsLookup({ status: 200, body: JSON.stringify({ chaveAcesso: "junk" }) }));
  });
});

