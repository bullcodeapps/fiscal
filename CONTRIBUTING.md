# Contributing

Thanks for helping. Bug reports, fixes for Sefin rejections and new fiscal documents are welcome.

## Before you start

- For a large change (a new document type, a new public API), open an issue first.
- Never commit certificates, passwords, personal data or real taxpayer data. Anonymize any XML captured from
  Sefin and remove its `<Signature>` elements. [AGENTS.md](./AGENTS.md) has the full rules.
- Report security problems privately. See [SECURITY.md](./SECURITY.md).

## Development

The build (tsup 9) needs Node 20.19+, 22.12+ or 24. The library itself runs on Node 20.11+.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm check:docs   # builds, then type-checks every ts block in README.md and docs/
```

[AGENTS.md](./AGENTS.md) describes the layout, the test fixtures and the schema checks.

## Pull requests

- Keep each PR to one change. CI must pass on Node 20, 22 and 24.
- Update `docs/` and the TSDoc in the same PR when behavior changes. Agents in consumer apps read those files.
- Add an entry to `CHANGELOG.md`.
- Every Sefin rule the XSD does not express gets a check in `src/nfse/dps.ts`, with the Sefin code in the
  message, and a test.

## Releases

A maintainer bumps `version` in `package.json` and adds the `CHANGELOG.md` entry in a PR. When that PR merges
to `main`, the Release workflow publishes to npm with provenance, tags `vX.Y.Z` and creates the GitHub release.
