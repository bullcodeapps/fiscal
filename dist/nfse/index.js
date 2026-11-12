import {
  findMunicipality,
  signEnveloped
} from "../chunk-Q3O3QATY.js";

// src/core/xml.ts
function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function leaf(name, value) {
  if (value === void 0 || value === null || value === "") return "";
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}
function group(name, ...children) {
  const body = children.filter(Boolean).join("");
  return body ? `<${name}>${body}</${name}>` : "";
}
function decimal(value) {
  return value === void 0 ? void 0 : value.toFixed(2);
}
function brazilDateTime(date2) {
  const local = new Date(date2.getTime() - 3 * 60 * 60 * 1e3);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

// src/nfse/dps.ts
var NAMESPACE = "http://www.sped.fazenda.gov.br/nfse";
var LAYOUT_VERSION = "1.01";
function dpsId(input) {
  const CNPJ_INSCRIPTION_TYPE = "2";
  return "DPS" + input.cLocEmi + CNPJ_INSCRIPTION_TYPE + input.CNPJ.padStart(14, "0") + input.serie.padStart(5, "0") + input.nDPS.padStart(15, "0");
}
function address(end) {
  if (!end) return "";
  return group(
    "end",
    "cMun" in end ? group("endNac", leaf("cMun", end.cMun), leaf("CEP", end.CEP)) : group(
      "endExt",
      leaf("cPais", end.cPais),
      leaf("cEndPost", end.cEndPost),
      leaf("xCidade", end.xCidade),
      leaf("xEstProvReg", end.xEstProvReg)
    ),
    leaf("xLgr", end.xLgr),
    leaf("nro", end.nro),
    leaf("xCpl", end.xCpl),
    leaf("xBairro", end.xBairro)
  );
}
function taker(toma) {
  if (!toma) return "";
  return group(
    "toma",
    "CNPJ" in toma ? leaf("CNPJ", toma.CNPJ) : "CPF" in toma ? leaf("CPF", toma.CPF) : "NIF" in toma ? leaf("NIF", toma.NIF) : leaf("cNaoNIF", toma.cNaoNIF),
    leaf("xNome", toma.xNome),
    address(toma.end),
    leaf("fone", toma.fone),
    leaf("email", toma.email)
  );
}
function locPrest(serv) {
  if (serv.cLocPrestacao === void 0 === (serv.cPaisPrestacao === void 0)) {
    throw new Error("serv: exactly one of cLocPrestacao or cPaisPrestacao");
  }
  return group(
    "locPrest",
    leaf("cLocPrestacao", serv.cLocPrestacao),
    leaf("cPaisPrestacao", serv.cPaisPrestacao)
  );
}
function foreignTrade(value) {
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
    leaf("nDI", value.nDI),
    leaf("nRE", value.nRE),
    leaf("mdic", value.mdic)
  );
}
function totTrib(value) {
  return group(
    "totTrib",
    "pTotTribSN" in value ? leaf("pTotTribSN", decimal(value.pTotTribSN)) : leaf("indTotTrib", value.indTotTrib)
  );
}
function usesNt009Layout(environment) {
  return environment === "restricted";
}
function ibsCbs(value, nt009) {
  if (!value) return "";
  const situation = [leaf("CST", value.CST), leaf("cClassTrib", value.cClassTrib)];
  return group(
    "IBSCBS",
    nt009 ? "" : leaf("finNFSe", 0),
    leaf("indFinal", value.indFinal),
    leaf("cIndOp", value.cIndOp),
    leaf("indDest", value.indDest),
    ...(value.bensMoveis ?? []).map(
      (good) => group(
        "bensMoveis",
        leaf("cNCMBemMovel", good.cNCMBemMovel),
        leaf("xNCMBemMovel", good.xNCMBemMovel),
        leaf("qtdNCMBemMovel", good.qtdNCMBemMovel)
      )
    ),
    group(
      "valores",
      group("trib", nt009 ? situation.join("") : group("gIBSCBS", ...situation))
    )
  );
}
function assertExportRules(input) {
  const { toma, serv, valores } = input;
  const foreignId = toma !== void 0 && ("NIF" in toma || "cNaoNIF" in toma);
  const foreignAddress = toma?.end !== void 0 && "cPais" in toma.end;
  if (foreignId && !foreignAddress) {
    throw new Error("toma: a taker identified by NIF or cNaoNIF requires a foreign address in end (E0223)");
  }
  if (foreignAddress && !foreignId) {
    throw new Error("toma: a foreign address in end requires the taker to be identified by NIF or cNaoNIF");
  }
  if (valores.tribISSQN === 3 && !serv.comExt) {
    throw new Error("serv: tribISSQN 3 (export of services) requires comExt (E0330)");
  }
  if (serv.comExt && toma && !foreignId) {
    throw new Error("serv: comExt requires a taker abroad (NIF or cNaoNIF), not a CNPJ or CPF");
  }
}
function buildDps(input) {
  assertExportRules(input);
  const id = dpsId({
    cLocEmi: input.cLocEmi,
    CNPJ: input.prest.CNPJ,
    serie: input.serie,
    nDPS: input.nDPS
  });
  const { prest, serv, valores } = input;
  const nt009 = usesNt009Layout(input.environment);
  const infDps = `<infDPS Id="${id}">` + leaf("tpAmb", input.environment === "production" ? 1 : 2) + leaf("dhEmi", brazilDateTime(input.dhEmi)) + leaf("verAplic", input.verAplic) + leaf("serie", input.serie) + leaf("nDPS", input.nDPS) + leaf("dCompet", input.dCompet) + leaf("tpEmit", 1) + (nt009 ? leaf("finNFSe", 0) : "") + leaf("cLocEmi", input.cLocEmi) + group(
    "prest",
    leaf("CNPJ", prest.CNPJ),
    leaf("IM", prest.IM),
    group(
      "regTrib",
      leaf("opSimpNac", prest.regTrib.opSimpNac),
      leaf("regApTribSN", prest.regTrib.regApTribSN),
      leaf("regEspTrib", prest.regTrib.regEspTrib)
    )
  ) + taker(input.toma) + group(
    "serv",
    locPrest(serv),
    group(
      "cServ",
      leaf("cTribNac", serv.cTribNac),
      leaf("cTribMun", serv.cTribMun),
      nt009 ? leaf("cNBS", serv.cNBS) : "",
      leaf("xDescServ", serv.xDescServ),
      nt009 ? "" : leaf("cNBS", serv.cNBS)
    ),
    foreignTrade(serv.comExt)
  ) + group(
    "valores",
    group("vServPrest", leaf("vServ", decimal(valores.vServ))),
    group(
      "trib",
      group(
        "tribMun",
        leaf("tribISSQN", valores.tribISSQN),
        leaf("tpRetISSQN", valores.tpRetISSQN),
        leaf("pAliq", decimal(valores.pAliq))
      ),
      totTrib(valores.totTrib)
    )
  ) + ibsCbs(input.IBSCBS, nt009) + "</infDPS>";
  return {
    id,
    xml: `<DPS xmlns="${NAMESPACE}" versao="${LAYOUT_VERSION}">${infDps}</DPS>`
  };
}

// src/nfse/sign.ts
function signDps(dpsXml, certificate) {
  return `<?xml version="1.0" encoding="UTF-8"?>${signEnveloped(dpsXml, "infDPS", certificate)}`;
}

// src/nfse/sefin-client.ts
import { gunzipSync, gzipSync } from "zlib";

// src/nfse/http.ts
import https from "https";
function mtlsAgent(certificate) {
  return new https.Agent({ key: certificate.privateKeyPem, cert: certificate.certificatePem });
}
function request(agent, url, method, timeoutMs, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        agent,
        timeout: timeoutMs,
        headers: {
          Accept: "application/json",
          ...body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// src/nfse/sefin-client.ts
var BASE_URLS = {
  production: "https://sefin.nfse.gov.br/SefinNacional",
  restricted: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional"
};
var SefinError = class extends Error {
  constructor(kind, messages, httpStatus) {
    super(
      messages.length ? messages.map((m) => `${m.code}: ${m.description}`).join("; ") : `Sefin Nacional indispon\xEDvel${httpStatus ? ` (HTTP ${httpStatus})` : ""}`
    );
    this.kind = kind;
    this.messages = messages;
    this.httpStatus = httpStatus;
  }
  kind;
  messages;
  httpStatus;
  name = "SefinError";
};
function toMessages(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return list.map((m) => {
    const complement = m.Complemento ?? m.complemento;
    return {
      code: String(m.Codigo ?? m.codigo ?? ""),
      description: String(m.Descricao ?? m.descricao ?? ""),
      ...complement ? { complement: String(complement) } : {}
    };
  });
}
function parseJson(body) {
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}
function interpretEmission(response) {
  const json = parseJson(response.body);
  if (response.status >= 200 && response.status < 300 && json) {
    const accessKey = json.chaveAcesso;
    const nfseGzip = json.nfseXmlGZipB64;
    if (typeof accessKey === "string" && typeof nfseGzip === "string") {
      return {
        accessKey,
        nfseXml: gunzipSync(Buffer.from(nfseGzip, "base64")).toString("utf8"),
        dpsId: String(json.idDps ?? json.idDPS ?? ""),
        alerts: toMessages(json.alertas)
      };
    }
  }
  const messages = toMessages(json?.erros ?? json?.erro);
  const definitive = response.status >= 400 && response.status < 500 && messages.length > 0;
  throw new SefinError(
    definitive ? "rejected" : "unavailable",
    messages,
    response.status
  );
}
function interpretEvent(response) {
  const json = parseJson(response.body);
  if (response.status >= 200 && response.status < 300 && typeof json?.eventoXmlGZipB64 === "string") {
    return gunzipSync(Buffer.from(json.eventoXmlGZipB64, "base64")).toString("utf8");
  }
  const messages = toMessages(json?.erro ?? json?.erros);
  throw new SefinError(
    response.status >= 400 && response.status < 500 && messages.length > 0 ? "rejected" : "unavailable",
    messages,
    response.status
  );
}
var SefinClient = class {
  baseUrl;
  agent;
  timeoutMs;
  constructor(options) {
    this.baseUrl = BASE_URLS[options.environment];
    this.agent = mtlsAgent(options.certificate);
    this.timeoutMs = options.timeoutMs ?? 3e4;
  }
  /** Sends a signed DPS. Authorization is synchronous. */
  async emit(signedDpsXml) {
    const body = JSON.stringify({
      dpsXmlGZipB64: gzipSync(signedDpsXml).toString("base64")
    });
    const response = await this.request("POST", "/nfse", body);
    return interpretEmission(response);
  }
  /**
   * Registers a signed event (e.g. `buildCancellation`). Returns the event
   * XML Sefin signed back. Resending an event that already went through is
   * rejected by Sefin, so an `unavailable` error is safe to retry.
   */
  async registerEvent(accessKey, signedEventXml) {
    const body = JSON.stringify({
      pedidoRegistroEventoXmlGZipB64: gzipSync(signedEventXml).toString("base64")
    });
    const response = await this.request("POST", `/nfse/${encodeURIComponent(accessKey)}/eventos`, body);
    return interpretEvent(response);
  }
  /** Reconciliation after an `unavailable` error. Null when Sefin never authorized it. */
  async findAccessKeyByDpsId(dpsId2) {
    const response = await this.request("GET", `/dps/${encodeURIComponent(dpsId2)}`);
    if (response.status === 404) return null;
    const json = parseJson(response.body);
    if (response.status === 200 && typeof json?.chaveAcesso === "string") {
      return json.chaveAcesso;
    }
    throw new SefinError("unavailable", toMessages(json?.erros), response.status);
  }
  async getNfseXml(accessKey) {
    const response = await this.request("GET", `/nfse/${encodeURIComponent(accessKey)}`);
    const json = parseJson(response.body);
    if (response.status === 200 && typeof json?.nfseXmlGZipB64 === "string") {
      return gunzipSync(Buffer.from(json.nfseXmlGZipB64, "base64")).toString("utf8");
    }
    const messages = toMessages(json?.erros);
    throw new SefinError(
      response.status === 404 ? "rejected" : "unavailable",
      messages,
      response.status
    );
  }
  async request(method, path, body) {
    try {
      return await request(this.agent, `${this.baseUrl}${path}`, method, this.timeoutMs, body);
    } catch {
      throw new SefinError("unavailable", []);
    }
  }
};

// src/nfse/danfse/render.ts
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// src/nfse/danfse/logo.ts
var NFSE_LOGO_PNG = Buffer.from(
  "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",
  "base64"
);

// src/nfse/danfse/model.ts
import { XMLParser } from "fast-xml-parser";
var EMPTY = "-";
var TP_EMIT = { "1": "Prestador", "2": "Tomador", "3": "Intermedi\xE1rio" };
var C_STAT = {
  "100": "NFS-e Gerada",
  "101": "NFS-e de Substitui\xE7\xE3o Gerada",
  "102": "NFS-e de Decis\xE3o Judicial ou Administrativa",
  "103": "NFS-e Avulsa"
};
var FIN_NFSE = {
  "0": "NFS-e regular",
  "1": "NFS-e de cr\xE9dito",
  "2": "NFS-e de d\xE9bito"
};
var OP_SIMP_NAC = {
  "1": "N\xE3o Optante",
  "2": "Optante - Microempreendedor Individual (MEI)",
  "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)",
  "4": "Optante - Pendente"
};
var REG_AP_TRIB_SN = {
  "1": "Regime de apura\xE7\xE3o dos tributos federais e municipal pelo Simples Nacional",
  "2": "Regime de apura\xE7\xE3o dos tributos federais pelo SN e o ISSQN pela NFS-e conforme respectiva legisla\xE7\xE3o municipal do tributo",
  "3": "Regime de apura\xE7\xE3o dos tributos federais e municipal pela NFS-e conforme respectivas legisla\xE7\xF5es federal e municipal de cada tributo"
};
var TRIB_ISSQN = {
  "1": "Opera\xE7\xE3o Tribut\xE1vel",
  "2": "Imunidade",
  "3": "Exporta\xE7\xE3o de Servi\xE7o",
  "4": "N\xE3o Incid\xEAncia"
};
var TP_RET_ISSQN = {
  "1": "N\xE3o Retido",
  "2": "Retido pelo Tomador",
  "3": "Retido pelo Intermedi\xE1rio"
};
var REG_ESP_TRIB = {
  "0": "Nenhum",
  "1": "Ato Cooperado (Cooperativa)",
  "2": "Estimativa",
  "3": "Microempresa Municipal",
  "4": "Not\xE1rio ou Registrador",
  "5": "Profissional Aut\xF4nomo",
  "6": "Sociedade de Profissionais",
  "9": "Outros"
};
var AMB_GER = { "1": "Prefeitura", "2": "Sistema Nacional da NFS-e" };
var TP_AMB = { "1": "Produ\xE7\xE3o", "2": "Homologa\xE7\xE3o" };
var ISSQN_NOT_INCIDENT = "4";
var QR_CODE_BASE = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=";
var text = (node, key) => {
  const value = node?.[key];
  return value === void 0 || value === null || value === "" ? void 0 : String(value);
};
var child = (node, key) => node?.[key];
var or = (value) => value ?? EMPTY;
var describe = (table, code) => code === void 0 ? EMPTY : table[code] ?? code;
function money(value) {
  if (value === void 0) return EMPTY;
  return `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function percent(value) {
  if (value === void 0) return EMPTY;
  return `${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
function sum(...values) {
  const present = values.filter((v) => v !== void 0);
  return present.length ? present.reduce((total, v) => total + Number(v), 0).toFixed(2) : void 0;
}
function document(node) {
  const cnpj = text(node, "CNPJ");
  if (cnpj) return cnpj.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\w{2})$/, "$1.$2.$3/$4-$5");
  const cpf = text(node, "CPF");
  if (cpf) return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return or(text(node, "NIF"));
}
function dateTime(value) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}` : EMPTY;
}
function date(value) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : EMPTY;
}
function cityUf(code) {
  const city = code ? findMunicipality(code) : null;
  return city ? `${city.name} / ${city.uf}` : EMPTY;
}
function partyFields(party, withMunicipalRegistration) {
  const { node, address: address2, nationalAddress, foreignAddress } = party;
  const cMun = text(nationalAddress, "cMun");
  const cep = text(nationalAddress, "CEP")?.replace(/^(\d{2})(\d{3})(\d{3})$/, "$1.$2-$3");
  const street = [
    text(address2, "xLgr"),
    text(address2, "nro"),
    text(address2, "xCpl"),
    text(address2, "xBairro")
  ].filter(Boolean);
  return [
    [
      { label: "CNPJ / CPF / NIF", value: document(node), col: 1 },
      ...withMunicipalRegistration ? [{ label: "Indicador Municipal (Inscri\xE7\xE3o)", value: or(text(node, "IM")), col: 2 }] : [],
      { label: "Telefone", value: or(text(node, "fone")), col: 3 }
    ],
    [
      { label: "Nome / Nome Empresarial", value: or(text(node, "xNome")), col: 0, span: 2 },
      ...foreignAddress ? [
        {
          label: "Cidade / Estado",
          value: [text(foreignAddress, "xCidade"), text(foreignAddress, "xEstProvReg")].map(or).join(" / "),
          col: 2
        },
        {
          label: "Pa\xEDs / C\xF3digo Postal",
          value: `${or(text(foreignAddress, "cPais"))} / ${or(text(foreignAddress, "cEndPost"))}`,
          col: 3
        }
      ] : [
        { label: "Munic\xEDpio / Sigla UF", value: cityUf(cMun), col: 2 },
        { label: "C\xF3digo IBGE / CEP", value: cMun || cep ? `${or(cMun)} / ${or(cep)}` : EMPTY, col: 3 }
      ]
    ],
    [
      { label: "Endere\xE7o", value: street.length ? street.join(", ") : EMPTY, col: 0, span: 2 },
      { label: "E-mail", value: or(text(node, "email")), col: 2, span: 2 }
    ]
  ];
}
var parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => name === "bensMoveis"
});
function buildDanfseModel(nfseXml) {
  const root = parser.parse(nfseXml);
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
  const totTrib2 = child(child(dpsValores, "trib"), "totTrib");
  const nfseValores = child(inf, "valores");
  const ibsCbs2 = child(inf, "IBSCBS");
  const ibsCbsValores = child(ibsCbs2, "valores");
  const totCibs = child(ibsCbs2, "totCIBS");
  const gIbs = child(totCibs, "gIBS");
  const dpsIbsCbs = child(infDps, "IBSCBS");
  const dpsIbsCbsTrib = child(child(dpsIbsCbs, "valores"), "trib");
  const accessKey = String(inf?.["@_Id"] ?? "").replace(/^NFS/, "");
  const tpAmb = text(infDps, "tpAmb");
  const dCompet = text(infDps, "dCompet");
  const tribIssqn = text(tribMun, "tribISSQN");
  const vIbsTot = text(gIbs, "vIBSTot");
  const vCbs = text(child(totCibs, "gCBS"), "vCBS");
  const blocks = [];
  const provider = partyFields(
    { node: { ...emit, ...prest, CNPJ: text(prest, "CNPJ") ?? text(emit, "CNPJ") }, address: child(emit, "enderNac"), nationalAddress: child(emit, "enderNac") },
    true
  );
  provider.push([
    { label: "Simples Nacional na Data de Compet\xEAncia", value: describe(OP_SIMP_NAC, text(regTrib, "opSimpNac")), col: 0 },
    { label: "Regime de Apura\xE7\xE3o Tribut\xE1ria pelo SN", value: describe(REG_AP_TRIB_SN, text(regTrib, "regApTribSN")), col: 1, span: 3 }
  ]);
  blocks.push({ title: "PRESTADOR / FORNECEDOR", rows: provider, rowHeight: 0.63 });
  blocks.push(
    toma ? {
      title: "TOMADOR / ADQUIRENTE",
      rows: partyFields({ node: toma, address: child(toma, "end"), nationalAddress: child(child(toma, "end"), "endNac"), foreignAddress: child(child(toma, "end"), "endExt") }, true),
      rowHeight: 0.63
    } : { title: "TOMADOR / ADQUIRENTE", message: "TOMADOR/ADQUIRENTE DA OPERA\xC7\xC3O N\xC3O IDENTIFICADO NA NFS-e", rows: [], rowHeight: 0.63 }
  );
  const dest = child(dpsIbsCbs, "dest");
  blocks.push(
    dest ? {
      title: "DESTINAT\xC1RIO DA OPERA\xC7\xC3O",
      rows: partyFields({ node: dest, address: child(dest, "end"), nationalAddress: child(child(dest, "end"), "endNac"), foreignAddress: child(child(dest, "end"), "endExt") }, false),
      rowHeight: 0.63
    } : {
      title: "DESTINAT\xC1RIO DA OPERA\xC7\xC3O",
      message: text(dpsIbsCbs, "indDest") === "1" ? "DESTINAT\xC1RIO DA OPERA\xC7\xC3O N\xC3O IDENTIFICADO NA NFS-e" : "O DESTINAT\xC1RIO \xC9 O PR\xD3PRIO TOMADOR/ADQUIRENTE DA OPERA\xC7\xC3O",
      rows: [],
      rowHeight: 0.63
    }
  );
  blocks.push(
    interm ? {
      title: "INTERMEDI\xC1RIO DA OPERA\xC7\xC3O",
      rows: partyFields({ node: interm, address: child(interm, "end"), nationalAddress: child(child(interm, "end"), "endNac"), foreignAddress: child(child(interm, "end"), "endExt") }, true),
      rowHeight: 0.63
    } : { title: "INTERMEDI\xC1RIO DA OPERA\xC7\xC3O", message: "INTERMEDI\xC1RIO DA OPERA\xC7\xC3O N\xC3O IDENTIFICADO NA NFS-e", rows: [], rowHeight: 0.63 }
  );
  const cTribNac = text(cServ, "cTribNac");
  const cTribMun = text(cServ, "cTribMun");
  const cNbs = text(cServ, "cNBS");
  const prestacaoUf = findMunicipality(text(child(serv, "locPrest"), "cLocPrestacao") ?? "")?.uf;
  blocks.push({
    title: "SERVI\xC7O PRESTADO",
    rows: [
      [
        {
          label: "C\xF3digo de Tributa\xE7\xE3o Nacional / Municipal",
          value: `${cTribNac ? cTribNac.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1.$2.$3") : EMPTY} / ${or(cTribMun)}`,
          col: 1
        },
        { label: "C\xF3digo da NBS", value: cNbs ? cNbs.replace(/^(\d)(\d{4})(\d{2})(\d{2})$/, "$1.$2.$3.$4") : EMPTY, col: 2 },
        {
          label: "Local da Presta\xE7\xE3o / Sigla UF / Pa\xEDs",
          value: text(inf, "xLocPrestacao") ? `${text(inf, "xLocPrestacao")} / ${or(prestacaoUf)} / BR` : EMPTY,
          col: 3
        }
      ]
    ],
    rowHeight: 0.63
  });
  if (tribIssqn === ISSQN_NOT_INCIDENT) {
    blocks.push({
      title: "TRIBUTA\xC7\xC3O MUNICIPAL (ISSQN)",
      message: "TRIBUTA\xC7\xC3O MUNICIPAL (ISSQN) - OPERA\xC7\xC3O N\xC3O SUJEITA AO ISSQN",
      rows: [],
      rowHeight: 0.63
    });
  } else {
    const exigSusp = child(tribMun, "exigSusp");
    const incidUf = findMunicipality(text(inf, "cLocIncid") ?? "")?.uf;
    const rows = [
      [
        { label: "Tipo de Tributa\xE7\xE3o do ISSQN", value: describe(TRIB_ISSQN, tribIssqn), col: 1 },
        {
          label: "Munic\xEDpio / Sigla UF / Pa\xEDs de Incid\xEAncia do ISSQN",
          value: text(inf, "xLocIncid") ? `${text(inf, "xLocIncid")} / ${or(incidUf)} / BR` : EMPTY,
          col: 2,
          span: 2
        }
      ],
      [
        { label: "Regime Especial de Tributa\xE7\xE3o do ISSQN", value: describe(REG_ESP_TRIB, text(regTrib, "regEspTrib")), col: 0 },
        { label: "Tipo de Imunidade do ISSQN", value: or(text(tribMun, "tpImunidade")), col: 1 },
        {
          label: "Suspens\xE3o da Exigibilidade do ISSQN",
          value: exigSusp ? text(exigSusp, "tpSusp") === "1" ? "Exigibilidade Suspensa por Decis\xE3o Judicial" : "Exigibilidade Suspensa por Processo Administrativo" : EMPTY,
          col: 2
        },
        { label: "N\xFAmero Processo Suspens\xE3o", value: or(text(exigSusp, "nProcesso")), col: 3 }
      ],
      [
        { label: "Benef\xEDcio Municipal", value: or(text(nfseValores, "tpBM")), col: 0 },
        { label: "C\xE1lculo do BM", value: money(text(nfseValores, "vCalcBM")), col: 1 },
        { label: "Total Dedu\xE7\xF5es/Redu\xE7\xF5es", value: money(text(nfseValores, "vCalcDR")), col: 2 },
        { label: "Desconto Incondicionado", value: money(text(child(dpsValores, "vDescCondIncond"), "vDescIncond")), col: 3 }
      ],
      [
        { label: "BC ISSQN", value: money(text(nfseValores, "vBC")), col: 0 },
        { label: "Al\xEDquota Aplicada", value: percent(text(nfseValores, "pAliqAplic")), col: 1 },
        { label: "Reten\xE7\xE3o do ISSQN", value: describe(TP_RET_ISSQN, text(tribMun, "tpRetISSQN")), col: 2 },
        { label: "ISSQN Apurado", value: money(text(nfseValores, "vISSQN")), col: 3 }
      ]
    ];
    blocks.push({
      title: "TRIBUTA\xC7\xC3O MUNICIPAL (ISSQN)",
      // Nota 5: the benefit/deduction row may go when all its fields are empty.
      rows: rows.filter((row, index) => index !== 2 || row.some((field2) => field2.value !== EMPTY)),
      rowHeight: 0.63
    });
  }
  const federalRows = [
    [
      { label: "IRRF", value: money(text(tribFed, "vRetIRRF")), col: 1 },
      { label: "Contribui\xE7\xE3o Previdenci\xE1ria - Retida", value: money(text(tribFed, "vRetCP")), col: 2 },
      { label: "Contribui\xE7\xF5es Sociais - Retidas", value: money(text(tribFed, "vRetCSLL")), col: 3 }
    ]
  ];
  if (!dCompet || Number(dCompet.slice(0, 4)) <= 2026) {
    federalRows.push([
      { label: "PIS - D\xE9bito Apura\xE7\xE3o Pr\xF3pria", value: money(text(piscofins, "vPis")), col: 0 },
      { label: "COFINS - D\xE9bito Apura\xE7\xE3o Pr\xF3pria", value: money(text(piscofins, "vCofins")), col: 1 },
      { label: "Descri\xE7\xE3o Contrib. Sociais - Retidas", value: or(text(piscofins, "tpRetPisCofins")), col: 2, span: 2 }
    ]);
  }
  blocks.push({ title: "TRIBUTA\xC7\xC3O FEDERAL (EXCETO CBS)", rows: federalRows, rowHeight: 0.63 });
  const uf = child(ibsCbsValores, "uf");
  const mun = child(ibsCbsValores, "mun");
  const fed = child(ibsCbsValores, "fed");
  const incidCity = text(ibsCbs2, "cLocalidadeIncid");
  blocks.push({
    title: "TRIBUTA\xC7\xC3O IBS / CBS",
    rows: [
      [
        { label: "CST / cClassTrib", value: `${or(text(dpsIbsCbsTrib, "CST"))} / ${or(text(dpsIbsCbsTrib, "cClassTrib"))}`, col: 1 },
        {
          label: "Indicador de Opera\xE7\xE3o / C\xF3digo IBGE Incid\xEAncia / Munic\xEDpio Incid\xEAncia / Sigla UF",
          value: [
            or(text(dpsIbsCbs, "cIndOp")),
            or(incidCity),
            or(text(ibsCbs2, "xLocalidadeIncid")),
            or(findMunicipality(incidCity ?? "")?.uf)
          ].join(" / "),
          col: 2,
          span: 2
        }
      ],
      [
        { label: "Exclus\xF5es e Redu\xE7\xF5es da Base de C\xE1lculo", value: money(sum(text(child(dpsValores, "vDescCondIncond"), "vDescIncond"), text(nfseValores, "vISSQN"), text(piscofins, "vPis"), text(piscofins, "vCofins"))), col: 0 },
        { label: "Base de C\xE1lculo Ap\xF3s Exclus\xF5es e Redu\xE7\xF5es", value: money(text(ibsCbsValores, "vBC")), col: 1 },
        {
          label: "Red. Al\xEDquota IBS / Red. Al\xEDquota CBS",
          value: `${percent(text(uf, "pRedAliqUF"))} / ${percent(text(mun, "pRedAliqMun"))} / ${percent(text(fed, "pRedAliqCBS"))}`,
          col: 2
        },
        { label: "Al\xEDquota - IBS UF / IBS Mun", value: `${percent(text(uf, "pIBSUF"))} / ${percent(text(mun, "pIBSMun"))}`, col: 3 }
      ],
      [
        { label: "Al\xEDq. Efetiva Municipal - IBS", value: percent(text(mun, "pAliqEfetMun")), col: 0 },
        { label: "Valor Apurado Municipal - IBS", value: money(text(child(gIbs, "gIBSMunTot"), "vIBSMun")), col: 1 },
        { label: "Al\xEDq. Efetiva Estadual - IBS", value: percent(text(uf, "pAliqEfetUF")), col: 2 },
        { label: "Valor Apurado Estadual - IBS", value: money(text(child(gIbs, "gIBSUFTot"), "vIBSUF")), col: 3 }
      ],
      [
        { label: "Valor Total Apurado - IBS", value: money(vIbsTot), col: 0 },
        { label: "Al\xEDquota - CBS", value: percent(text(fed, "pCBS")), col: 1 },
        { label: "Al\xEDquota Efetiva - CBS", value: percent(text(fed, "pAliqEfetCBS")), col: 2 },
        { label: "Valor Total Apurado - CBS", value: money(vCbs), col: 3 }
      ]
    ],
    rowHeight: 0.63
  });
  blocks.push({
    title: "VALOR TOTAL DA NFS-E",
    rows: [
      [
        { label: "VALOR DA OPERA\xC7\xC3O / SERVI\xC7O", value: money(text(child(dpsValores, "vServPrest"), "vServ")), col: 1 },
        { label: "Desconto Incondicionado", value: money(text(child(dpsValores, "vDescCondIncond"), "vDescIncond")), col: 2 },
        { label: "Desconto Condicionado", value: money(text(child(dpsValores, "vDescCondIncond"), "vDescCond")), col: 3 }
      ],
      [
        { label: "Total das Reten\xE7\xF5es (ISSQN / Federais)", value: money(text(nfseValores, "vTotalRet")), col: 0 },
        { label: "VALOR L\xCDQUIDO DA NFS-e", value: money(text(nfseValores, "vLiq")), col: 1 },
        { label: "Total do IBS/CBS", value: money(sum(vIbsTot, vCbs)), col: 2 },
        { label: "VALOR L\xCDQUIDO DA NFS-e + IBS/CBS", value: money(text(totCibs, "vTotNF")), col: 3, shaded: true }
      ]
    ],
    rowHeight: 0.67
  });
  const infoCompl = child(serv, "infoCompl");
  const complementaryInfo = [
    text(infoCompl, "xInfComp") && `Inf. Cont.: ${text(infoCompl, "xInfComp")}`,
    text(child(infDps, "subst"), "chSubstda") && `NFS-e Subst.: ${text(child(infDps, "subst"), "chSubstda")}`,
    text(infoCompl, "docRef") && `Doc. Ref.: ${text(infoCompl, "docRef")}`,
    text(infoCompl, "idDocTec") && `Doc. Tec.: ${text(infoCompl, "idDocTec")}`,
    text(infoCompl, "xPed") && `N\xFAm. Ped.: ${text(infoCompl, "xPed")}`,
    text(inf, "xOutInf") && `Inf. A. T. Mun.: ${text(inf, "xOutInf")}`,
    ...(dpsIbsCbs?.bensMoveis ?? []).map(
      (good) => `Bem M\xF3vel: NCM ${or(text(good, "cNCMBemMovel"))} - ${or(text(good, "xNCMBemMovel"))} (${or(text(good, "qtdNCMBemMovel"))})`
    )
  ].filter((line2) => Boolean(line2));
  complementaryInfo.push(approximateTaxes(totTrib2));
  return {
    accessKey,
    qrCodeUrl: `${QR_CODE_BASE}${accessKey}`,
    header: {
      municipality: `Munic\xEDpio: ${or(text(inf, "xLocEmi"))} - ${or(text(child(emit, "enderNac"), "UF"))}`,
      generator: `Ambiente Gerador: ${describe(AMB_GER, text(inf, "ambGer"))}`,
      environment: `Tipo de Ambiente: ${describe(TP_AMB, tpAmb)}`
    },
    withoutLegalValue: tpAmb === "2",
    identification: [
      [
        { label: "N\xDAMERO DA NFS-E", value: or(text(inf, "nNFSe")), col: 0 },
        { label: "COMPET\xCANCIA DA NFS-E", value: date(dCompet), col: 1 },
        { label: "DATA E HORA DA EMISS\xC3O DA NFS-E", value: dateTime(text(inf, "dhProc")), col: 2 }
      ],
      [
        { label: "N\xDAMERO DA DPS", value: or(text(infDps, "nDPS")), col: 0 },
        { label: "S\xC9RIE DA DPS", value: or(text(infDps, "serie")), col: 1 },
        { label: "DATA E HORA DA EMISS\xC3O DA DPS", value: dateTime(text(infDps, "dhEmi")), col: 2 }
      ],
      [
        { label: "EMITENTE DA NFS-E", value: describe(TP_EMIT, text(infDps, "tpEmit")), col: 0, shaded: true },
        { label: "SITUA\xC7\xC3O DA NFS-E", value: describe(C_STAT, text(inf, "cStat")), col: 1 },
        { label: "FINALIDADE", value: describe(FIN_NFSE, text(infDps, "finNFSe")), col: 2 }
      ]
    ],
    blocks,
    serviceCodeDescription: or(text(cServ, "xTribMun") ?? text(inf, "xTribNac")),
    serviceDescription: or(text(cServ, "xDescServ")),
    complementaryInfo
  };
}
function approximateTaxes(totTrib2) {
  const prefix = "Totais Aproximados dos Tributos cfe. Lei n\xBA 12.741/2012:";
  const pTotTribSN = text(totTrib2, "pTotTribSN");
  if (pTotTribSN) return `${prefix} Simples Nacional: ${percent(pTotTribSN)}`;
  const value = child(totTrib2, "vTotTrib");
  if (value) {
    return `${prefix} Federais: ${money(text(value, "vTotTribFed"))}; Estaduais: ${money(text(value, "vTotTribEst"))}; Municipais: ${money(text(value, "vTotTribMun"))}`;
  }
  const rate = child(totTrib2, "pTotTrib");
  if (rate) {
    return `${prefix} Federais: ${percent(text(rate, "pTotTribFed"))}; Estaduais: ${percent(text(rate, "pTotTribEst"))}; Municipais: ${percent(text(rate, "pTotTribMun"))}`;
  }
  return `${prefix} Federais: ${EMPTY}; Estaduais: ${EMPTY}; Municipais: ${EMPTY}`;
}

// src/nfse/danfse/render.ts
var CM = 72 / 2.54;
var PAGE_HEIGHT_CM = 29.7;
var MARGIN = 0.2;
var LEFT = 0.3;
var CONTENT_WIDTH = 20.4;
var COLUMNS = [0.3, 5.41, 10.51, 15.62];
var SPAN_WIDTH = [0, 5.09, 10.19, 15.3, 20.4];
var SHADE = "#F2F2F2";
var RED = "#E30613";
var BOLD = "Helvetica-Bold";
var REGULAR = "Helvetica";
var MESSAGE_HEIGHT = 0.4;
var BOTTOM = PAGE_HEIGHT_CM - 0.3;
var pt = (cm) => cm * CM;
function line(doc, y) {
  doc.lineWidth(0.5).moveTo(pt(LEFT), pt(y)).lineTo(pt(LEFT + CONTENT_WIDTH), pt(y)).stroke("#000000");
}
function shade(doc, x, y, width, height) {
  doc.rect(pt(x), pt(y), pt(width), pt(height)).fill(SHADE).fillColor("#000000");
}
function write(doc, value, x, y, width, options = {}) {
  doc.font(options.font ?? REGULAR).fontSize(options.size ?? 7).fillColor(options.color ?? "#000000").text(value, pt(x) + 2, pt(y), {
    width: pt(width) - 4,
    // One line: pdfkit only applies the ellipsis once a height caps the box.
    height: (options.size ?? 7) * 1.2,
    ellipsis: true,
    align: options.align ?? "left"
  });
}
function field(doc, item, y, height, labelSize) {
  const x = COLUMNS[item.col];
  const width = SPAN_WIDTH[item.span ?? 1];
  if (item.shaded) shade(doc, x, y, width, height);
  write(doc, item.label, x, y + 0.08, width, { font: BOLD, size: labelSize });
  write(doc, item.value, x, y + 0.34, width);
}
function block(doc, item, top) {
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
async function renderDanfse(nfseXml) {
  const model = buildDanfseModel(nfseXml);
  const qrCode = await QRCode.toBuffer(model.qrCodeUrl, { margin: 0, width: 240, errorCorrectionLevel: "M" });
  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `DANFSe ${model.accessKey}` } });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  shade(doc, LEFT, 0.3, CONTENT_WIDTH, 1.16);
  doc.image(NFSE_LOGO_PNG, pt(0.49), pt(0.44), { fit: [pt(4), pt(0.85)] });
  write(doc, "DANFSe v2.0", 5.41, 0.4, 10.19, { font: BOLD, size: 9, align: "center" });
  write(doc, "Documento Auxiliar da NFS-e", 5.41, 0.75, 10.19, { font: BOLD, size: 9, align: "center" });
  if (model.withoutLegalValue) {
    write(doc, "NFS-e SEM VALIDADE JUR\xCDDICA", 5.41, 1.1, 10.19, { font: BOLD, size: 9, color: RED, align: "center" });
  }
  write(doc, model.header.municipality, 15.62, 0.4, 5.09, { size: 8 });
  write(doc, model.header.generator, 15.62, 0.97, 5.09, { size: 6 });
  write(doc, model.header.environment, 15.62, 1.22, 5.09, { size: 6 });
  line(doc, 1.46);
  write(doc, "CHAVE DE ACESSO DA NFS-E", LEFT, 1.56, 15.3, { font: BOLD });
  write(doc, model.accessKey, LEFT, 1.86, 15.3);
  model.identification.forEach((row, index) => {
    row.forEach((cell) => field(doc, cell, 2.27 + index * 0.69, 0.67, 7));
  });
  doc.image(qrCode, pt(17.48), pt(1.67), { width: pt(1.52), height: pt(1.52) });
  doc.font(REGULAR).fontSize(6).fillColor("#000000").text(
    "A autenticidade desta NFS-e pode ser verificada pela leitura deste c\xF3digo QR ou pela consulta da chave de acesso no portal nacional da NFS-e",
    pt(15.8),
    pt(3.36),
    { width: pt(4.72), height: pt(0.9), ellipsis: true }
  );
  let y = 4.34;
  for (const item of model.blocks) {
    y = block(doc, item, y);
    if (item.title === "SERVI\xC7O PRESTADO") {
      write(doc, model.serviceCodeDescription, LEFT, y + 0.06, CONTENT_WIDTH, { color: "#555555" });
      y += 0.4;
      write(doc, "Descri\xE7\xE3o do Servi\xE7o", LEFT, y, CONTENT_WIDTH, { font: BOLD, size: 6 });
      doc.font(REGULAR).fontSize(7);
      const height = Math.min(
        Math.max(doc.heightOfString(model.serviceDescription, { width: pt(CONTENT_WIDTH) - 4 }) / CM, 0.4),
        3
      );
      doc.text(model.serviceDescription, pt(LEFT) + 2, pt(y + 0.28), {
        width: pt(CONTENT_WIDTH) - 4,
        height: pt(height),
        ellipsis: true
      });
      y += 0.28 + height + 0.1;
    }
  }
  line(doc, y);
  write(doc, "INFORMA\xC7\xD5ES COMPLEMENTARES", LEFT, y + 0.08, CONTENT_WIDTH, { font: BOLD });
  doc.font(REGULAR).fontSize(7).fillColor("#000000").text(model.complementaryInfo.join(" | "), pt(LEFT) + 2, pt(y + 0.4), {
    width: pt(CONTENT_WIDTH) - 4,
    height: Math.max(pt(BOTTOM - y - 0.5), 0),
    ellipsis: true
  });
  doc.lineWidth(1).rect(pt(MARGIN), pt(MARGIN), pt(21 - 2 * MARGIN), pt(PAGE_HEIGHT_CM - 2 * MARGIN)).stroke("#000000");
  doc.end();
  return done;
}

// src/nfse/events.ts
var NAMESPACE2 = "http://www.sped.fazenda.gov.br/nfse";
var LAYOUT_VERSION2 = "1.01";
var CANCELLATION = "101101";
function buildCancellation(input, certificate) {
  const description = input.description.trim();
  if (description.length < 15 || description.length > 255) {
    throw new RangeError("A justificativa do cancelamento deve ter entre 15 e 255 caracteres.");
  }
  const xml = `<pedRegEvento xmlns="${NAMESPACE2}" versao="${LAYOUT_VERSION2}"><infPedReg Id="PRE${input.accessKey}${CANCELLATION}">` + leaf("tpAmb", input.environment === "production" ? 1 : 2) + leaf("verAplic", input.verAplic) + leaf("dhEvento", brazilDateTime(input.at)) + leaf("CNPJAutor", input.authorCnpj) + leaf("chNFSe", input.accessKey) + `<e${CANCELLATION}><xDesc>Cancelamento de NFS-e</xDesc>` + leaf("cMotivo", input.reason) + `<xMotivo>${escapeXml(description)}</xMotivo></e${CANCELLATION}></infPedReg></pedRegEvento>`;
  return `<?xml version="1.0" encoding="UTF-8"?>${signEnveloped(xml, "infPedReg", certificate)}`;
}

// src/nfse/summary.ts
import { XMLParser as XMLParser2 } from "fast-xml-parser";
var parser2 = new XMLParser2({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false
});
function readNfseSummary(nfseXml) {
  const inf = parser2.parse(nfseXml)?.NFSe?.infNFSe;
  const infDps = inf?.DPS?.infDPS;
  const toma = infDps?.toma;
  const vServ = infDps?.valores?.vServPrest?.vServ;
  const description = infDps?.serv?.cServ?.xDescServ;
  const text2 = (value) => value === void 0 || value === null ? null : String(value);
  return {
    accessKey: String(inf?.["@_Id"] ?? "").replace(/^NFS/, ""),
    number: inf?.nNFSe === void 0 ? null : String(inf.nNFSe),
    takerDocument: toma?.CNPJ ?? toma?.CPF ?? null,
    serviceValueCents: Math.round(Number(vServ ?? 0) * 100),
    competenceDate: infDps?.dCompet ?? null,
    description: description === void 0 ? null : String(description),
    providerDocument: text2(inf?.emit?.CNPJ ?? inf?.emit?.CPF),
    takerName: text2(toma?.xNome),
    takerNif: text2(toma?.NIF),
    issuedAt: text2(infDps?.dhEmi),
    issqnCents: Math.round(Number(inf?.valores?.vISSQN ?? 0) * 100),
    issqnInSimples: String(infDps?.prest?.regTrib?.regApTribSN ?? "") === "1"
  };
}
function readNfseEventSummary(eventXml) {
  const infPedReg = findKey(parser2.parse(eventXml), "infPedReg");
  const codeKey = Object.keys(infPedReg ?? {}).find((key) => /^e\d{6}$/.test(key));
  return {
    accessKey: String(infPedReg?.chNFSe ?? ""),
    code: codeKey ? codeKey.slice(1) : null
  };
}
function findKey(node, key) {
  if (!node || typeof node !== "object") return void 0;
  const record = node;
  if (key in record) return record[key];
  for (const child2 of Object.values(record)) {
    const found = findKey(child2, key);
    if (found !== void 0) return found;
  }
  return void 0;
}

// src/nfse/adn-client.ts
import { gunzipSync as gunzipSync2 } from "zlib";
var BASE_URLS2 = {
  production: "https://adn.nfse.gov.br/contribuintes",
  restricted: "https://adn.producaorestrita.nfse.gov.br/contribuintes"
};
var AdnError = class extends Error {
  constructor(kind, messages, httpStatus) {
    super(
      messages.length ? messages.map((m) => `${m.code}: ${m.description}`).join("; ") : `ADN indispon\xEDvel${httpStatus ? ` (HTTP ${httpStatus})` : ""}`
    );
    this.kind = kind;
    this.messages = messages;
    this.httpStatus = httpStatus;
  }
  kind;
  messages;
  httpStatus;
  name = "AdnError";
};
function parseJson2(body) {
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}
function toMessages2(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return list.map((m) => ({
    code: String(m.Codigo ?? m.codigo ?? ""),
    description: String(m.Descricao ?? m.descricao ?? "")
  }));
}
function interpretDistribution(response) {
  if (response.status === 429) throw new AdnError("rate_limited", [], 429);
  const json = parseJson2(response.body);
  const status = json?.StatusProcessamento;
  if (status === "NENHUM_DOCUMENTO_LOCALIZADO") return [];
  if (status === "DOCUMENTOS_LOCALIZADOS" && response.status >= 200 && response.status < 300) {
    const batch = Array.isArray(json?.LoteDFe) ? json.LoteDFe : [];
    return batch.map((doc) => ({
      nsu: Number(doc.NSU),
      accessKey: typeof doc.ChaveAcesso === "string" ? doc.ChaveAcesso : null,
      type: String(doc.TipoDocumento ?? ""),
      xml: gunzipSync2(Buffer.from(String(doc.ArquivoXml ?? ""), "base64")).toString("utf8")
    }));
  }
  const messages = toMessages2(json?.Erros);
  if (status === "REJEICAO") throw new AdnError("rejected", messages, response.status);
  throw new AdnError("unavailable", messages, response.status);
}
var AdnClient = class {
  baseUrl;
  agent;
  timeoutMs;
  constructor(options) {
    this.baseUrl = BASE_URLS2[options.environment];
    this.agent = mtlsAgent(options.certificate);
    this.timeoutMs = options.timeoutMs ?? 3e4;
  }
  /**
   * The next page (up to 50) of documents with an NSU above `lastNsu`, in NSU order. Start with 0 and
   * call again with the highest NSU received until a call returns nothing.
   */
  async fetchDocuments(lastNsu) {
    let response;
    try {
      response = await request(this.agent, `${this.baseUrl}/DFe/${lastNsu}?lote=true`, "GET", this.timeoutMs);
    } catch {
      throw new AdnError("unavailable", []);
    }
    return interpretDistribution(response).filter((doc) => doc.nsu > lastNsu);
  }
};
export {
  AdnClient,
  AdnError,
  SefinClient,
  SefinError,
  buildCancellation,
  buildDanfseModel,
  buildDps,
  dpsId,
  readNfseEventSummary,
  readNfseSummary,
  renderDanfse,
  signDps
};
