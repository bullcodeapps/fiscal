import { C as Certificate } from './environment-fHjUnJ9t.js';
export { a as CertificateError, b as CertificateErrorCode, E as Environment, l as loadCertificate } from './environment-fHjUnJ9t.js';

/**
 * Enveloped XMLDSig over the element carrying the `Id` attribute
 * (`infDPS`, `infPedReg`, ...). The Signature is appended as the last child
 * of that element's parent, which is where the Brazilian DF-e schemas expect it.
 */
declare function signEnveloped(xml: string, signedElement: string, certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">): string;

/**
 * 7-digit IBGE code for a city typed by a person ("Itajai", "SÃO PAULO").
 * Accents, case, apostrophes and hyphens are ignored. Null when no
 * municipality of that state has the name.
 */
declare function findMunicipalityCode(city: string, uf: string): string | null;
/** Municipality name and UF for a 7-digit IBGE code. */
declare function findMunicipality(code: string): {
    name: string;
    uf: string;
} | null;

export { Certificate, findMunicipality, findMunicipalityCode, signEnveloped };
