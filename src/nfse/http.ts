import https from "node:https";
import type { Certificate } from "../core/certificate";

export interface RawResponse {
  status: number;
  body: string;
}

export function mtlsAgent(certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">): https.Agent {
  return new https.Agent({ key: certificate.privateKeyPem, cert: certificate.certificatePem });
}

/** Rejects only when no HTTP answer arrived (network error or timeout). */
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
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
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
