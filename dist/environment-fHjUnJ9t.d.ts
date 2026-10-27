type CertificateErrorCode = "unreadable" | "missing_key" | "missing_cnpj";
/** `message` is Portuguese and safe to show to the certificate owner. */
declare class CertificateError extends Error {
    readonly code: CertificateErrorCode;
    readonly name = "CertificateError";
    constructor(code: CertificateErrorCode, message: string);
}
interface Certificate {
    cnpj: string;
    subjectName: string;
    issuerName: string;
    serialNumber: string;
    validFrom: Date;
    validTo: Date;
    privateKeyPem: string;
    certificatePem: string;
}
declare function loadCertificate(pfx: Buffer, password: string): Certificate;

/** tpAmb: production (1) or produção restrita / homologação (2). */
type Environment = "production" | "restricted";

export { type Certificate as C, type Environment as E, CertificateError as a, type CertificateErrorCode as b, loadCertificate as l };
