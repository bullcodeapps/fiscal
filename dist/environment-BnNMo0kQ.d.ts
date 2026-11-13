type CertificateErrorCode = "unreadable" | "missing_key" | "missing_cnpj";
/** `message` is Portuguese and safe to show to the certificate owner. */
declare class CertificateError extends Error {
    readonly code: CertificateErrorCode;
    readonly name = "CertificateError";
    constructor(code: CertificateErrorCode, message: string);
}
/** An opened A1 e-CNPJ. Holds the private key: keep it in memory only, never log or persist it. */
interface Certificate {
    /** The holder's CNPJ, 14 digits. Use it as `prest.CNPJ` and `authorCnpj`. */
    cnpj: string;
    /** Subject CN, usually "RAZAO SOCIAL:CNPJ". */
    subjectName: string;
    /** Issuing CA CN. */
    issuerName: string;
    serialNumber: string;
    validFrom: Date;
    /** Sefin refuses an expired certificate at the TLS handshake (HTTP 401/403). */
    validTo: Date;
    privateKeyPem: string;
    certificatePem: string;
}
/**
 * Opens an ICP-Brasil A1 e-CNPJ (.pfx / .p12) and reads its CNPJ.
 *
 * @throws {CertificateError} `unreadable` (wrong password or bad file), `missing_key`, `missing_cnpj`.
 * @example
 * const certificate = loadCertificate(readFileSync("cert.pfx"), password);
 * certificate.cnpj; // "11222333000181"
 * @see docs/integration.md section 2
 */
declare function loadCertificate(pfx: Buffer, password: string): Certificate;

/** tpAmb: production (1) or produção restrita / homologação (2). */
type Environment = "production" | "restricted";

export { type Certificate as C, type Environment as E, CertificateError as a, type CertificateErrorCode as b, loadCertificate as l };
