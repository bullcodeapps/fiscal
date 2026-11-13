# Security

## Reporting a vulnerability

Report it privately through GitHub: **Security > Report a vulnerability** on this repository. Do not open a
public issue. Expect a first answer within 5 business days.

## Security model

- The library never stores, logs or sends the certificate or its password anywhere except the mTLS handshake
  with the official Sefin and ADN hosts (`*.nfse.gov.br`). TLS server verification uses Node's defaults.
- `Certificate.privateKeyPem` is the decrypted private key. The app must keep it in memory only and store the
  `.pfx` and its password encrypted.
- `loadCertificate` accepts untrusted `.pfx` files: it refuses key-derivation iteration counts above 200,000,
  which would otherwise block the event loop.
- XML text values are escaped when the DPS and events are built, and the fields that form `Id` attributes are
  validated as digits. The library does not verify signatures of
  XML it receives; it trusts Sefin and the ADN over TLS.
- Never commit real certificates, passwords or taxpayer data, including XML captured from Sefin (its
  signatures embed the issuer's certificate, which carries the legal representative's CPF and birth date).
