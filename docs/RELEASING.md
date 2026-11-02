# Releasing

Publishing happens only from GitHub Actions, with npm provenance. Nothing is ever published from
a local machine: `prepublishOnly` refuses a plain `npm publish`.

## One-time setup

1. **npm**: the `@scoro` organisation must exist on npmjs.com and the publishing identity must be
   allowed to publish `@scoro/n8n-nodes-scoro`. Pick one of:
   - **Trusted Publishing (recommended, no secret)**: on the package page, Settings → Publish
     access → Trusted Publishers → GitHub Actions, with repository owner `Scoro-Software`,
     repository `n8n-nodes-scoro`, workflow `publish.yml`. Available only after the first publish
     has created the package, so the very first release uses a token.
   - **Automation token**: Access Tokens → Generate New Token → Granular Access Token with
     read/write on this package. Store it in the GitHub repository as the `NPM_TOKEN` secret
     (Settings → Secrets and variables → Actions).
2. **GitHub**: the `publish.yml` workflow needs `id-token: write` (already set) for provenance.
   Releases are cut from `main`, so merge the feature branch first.
3. **Locally**: `npm run release` creates a GitHub release through release-it, which needs a
   `GITHUB_TOKEN` environment variable with `repo` scope on your machine.

## Cutting a release

```bash
git checkout main && git pull
npm run release
```

`npm run release` runs `n8n-node release`, which on a developer machine:

1. runs `npm run lint` and `npm run build`;
2. prompts for the version bump (the package starts at `0.0.0`, so the first release is a
   *minor* bump to `0.1.0`);
3. regenerates `CHANGELOG.md` from the commit history (`auto-changelog`), commits
   `chore(release): vX.Y.Z`, tags `vX.Y.Z` (see `.release-it.json`), pushes, and creates the
   GitHub release.

Pushing the `vX.Y.Z` tag starts `.github/workflows/publish.yml`, which runs lint and build again
and publishes to npm with `NPM_CONFIG_PROVENANCE=true`. The package is public (`publishConfig.access`).

## After the first release

- Check the package on npm: <https://www.npmjs.com/package/@scoro/n8n-nodes-scoro> shows the
  provenance badge.
- Run the community package scan against the published version:
  `npx @n8n/scan-community-package @scoro/n8n-nodes-scoro`.
- Switch npm to Trusted Publishing and delete the `NPM_TOKEN` secret.
- Submit the package for verification (see `docs/VERIFICATION.md`).

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`: install, lint,
build, the trigger harness (`testing/scripts/trigger-harness.mjs`) and `npm pack --dry-run` to
show what would be published.
