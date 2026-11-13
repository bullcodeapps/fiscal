import https from "node:https";
import { gunzipSync } from "node:zlib";
import type { Certificate } from "../core/certificate";

// Notes and pages of 50 documents are far below this; anything larger is not a valid answer.
const MAX_BYTES = 10 * 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Decodes base64 gzip payloads against one shared budget of 10 MB of output, so a page of
 * documents cannot inflate past it either. Throws on malformed data or when the budget runs out.
 */
export function gunzipBase64(...values: string[]): string[] {
  let budget = MAX_BYTES;
  return values.map((value) => {
    if (!BASE64.test(value)) throw new Error("malformed base64");
    const xml = gunzipSync(Buffer.from(value, "base64"), { maxOutputLength: Math.max(budget, 1) });
    budget -= xml.length;
    if (budget < 0) throw new Error("decompressed output above size cap");
    // Buffer#toString would turn invalid bytes into U+FFFD and silently change the stored XML.
    return UTF8.decode(xml);
  });
}

export interface RawResponse {
  status: number;
  body: string;
}

export function mtlsAgent(certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">): https.Agent {
  return new https.Agent({ key: certificate.privateKeyPem, cert: certificate.certificatePem });
}

/** Rejects only when no complete HTTP answer arrived (network error, idle timeout, body above 10 MB). */
export function request(
  agent: https.Agent,
  url: string,
  method: "GET" | "POST",
  timeoutMs: number,
  body?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        agent,
        timeout: timeoutMs,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) req.destroy(new Error("response above size cap"));
          else chunks.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
