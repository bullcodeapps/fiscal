import { SignedXml } from "xml-crypto";
import type { Certificate } from "./certificate";

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";

function certificateBase64(pem: string): string {
  return pem.replace(/-----[^-]+-----|\s/g, "");
}

/**
 * Enveloped XMLDSig over the element carrying the `Id` attribute
 * (`infDPS`, `infPedReg`, ...). The Signature is appended as the last child
 * of that element's parent, which is where the Brazilian DF-e schemas expect it.
 */
export function signEnveloped(
  xml: string,
  signedElement: string,
  certificate: Pick<Certificate, "privateKeyPem" | "certificatePem">,
): string {
  const signer = new SignedXml({
    privateKey: certificate.privateKeyPem,
    publicCert: certificate.certificatePem,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: C14N,
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certificateBase64(certificate.certificatePem)}</X509Certificate></X509Data>`,
  });
  signer.addReference({
    xpath: `//*[local-name(.)='${signedElement}']`,
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", C14N],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  signer.computeSignature(xml, {
    location: {
      reference: `//*[local-name(.)='${signedElement}']`,
      action: "after",
    },
  });
  return signer.getSignedXml();
}
