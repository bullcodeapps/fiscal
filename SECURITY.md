# Security

## Reporting a vulnerability

Report it privately through GitHub: **Security > Report a vulnerability** on this repository. Do not open a
public issue. Expect a first answer within 5 business days.

## Security model

- The private key and the `.pfx` password never leave the process, except as the mTLS client key in the
  handshake with the official Sefin and ADN hosts (`*.nfse.gov.br`). TLS server verification uses Node's defaults.
- `Certificate.privateKeyPem` is the decrypted private key. Keep it in memory only. Store the `.pfx` and its
  password encrypted, and never log them.
- The public certificate is embedded in every signed DPS and event XML, and Sefin returns it inside the NFS-e
  XML. For an e-CNPJ it carries holder data, including the legal representative's CPF and birth date. Treat
  signed DPS XML, NFS-e XML and event XML as personal data.
- `loadCertificate` only extracts data. It does not validate the ICP-Brasil chain, so `certificate.cnpj` is not
  proof that the uploader owns the company. Never use it for authorization.
- `loadCertificate` refuses `.pfx` files over 64 KB, passwords over 256 characters and more than 300,000
  key-derivation iterations in total. It is synchronous: an accepted file can still cost about 0.3 s of CPU, so
  rate-limit certificate uploads or parse them in a worker thread.
- Sefin answers are limited to 10 MB, compressed and decompressed. An ADN page is limited to 10 MB of body and
  10 MB decompressed in total. Larger or malformed answers throw `SefinError` / `AdnError` with kind `unavailable`.
- XML text values are escaped when the DPS and events are built, and the fields that form `Id` attributes are
  validated (digits, or uppercase letters for a CNPJ). The library does not verify signatures of XML it
  receives; it trusts Sefin and the ADN over TLS.
- Never commit certificates, passwords or XML captured from Sefin without anonymizing it and removing its
  signatures.
