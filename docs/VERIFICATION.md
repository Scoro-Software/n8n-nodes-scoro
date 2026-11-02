# Submission for n8n verification

Text and checklist for submitting the package through the
[n8n Creator Portal](https://creators.n8n.io/nodes) after the first stable npm release. Submission is
done by a person; this file keeps the inputs in one place.

## Submission text

| Field | Value |
|---|---|
| Package name | `@scoro/n8n-nodes-scoro` |
| npm | <https://www.npmjs.com/package/@scoro/n8n-nodes-scoro> |
| Repository | <https://github.com/Scoro-Software/n8n-nodes-scoro> (public, MIT) |
| Author / maintainer | Scoro Software (matches npm and GitHub) |
| Service | Scoro (work management: projects, tasks, time, CRM, quotes, orders, invoices) via the Scoro API v4 |
| Authentication | OAuth2 (authorization code with PKCE) against the customer's own Scoro site, using an app registered in the Scoro Developer Portal. Fixed scope list, documented in the README. |
| Nodes | **Scoro Trigger** (programmatic trigger node): starts workflows on created / modified / deleted records of any Scoro module through Scoro webhooks, with optional retrieval of the current record from the API v4. |
| Credentials | **Scoro OAuth2 API**, usable from the HTTP Request node (Predefined Credential Type) to call any Scoro API v4 endpoint. |
| Description | Official Scoro package for n8n. Connect to Scoro with OAuth2 and call the Scoro API v4 from the HTTP Request node, and start workflows from Scoro webhooks with the Scoro Trigger. |
| Documentation | README in the repository and npm package: installation, Developer Portal setup, scopes, HTTP Request usage, trigger behaviour and limits, example workflows, version history. |

## Checklist against n8n's verification guidelines

| Requirement | Status |
|---|---|
| Built with the `n8n-node` CLI scaffolding (`npm create @n8n/node`) | Yes. `@n8n/node-cli` is a dev dependency; lint, build, dev and release go through it. |
| Package name `@<scope>/n8n-nodes-*`, keyword `n8n-community-node-package`, `n8n` block with nodes and credentials | Yes (`package.json`). |
| One third-party service per package, no logic/flow nodes, trigger in programmatic style | Yes: Scoro only; the trigger is programmatic. |
| No runtime dependencies | Yes: no `dependencies` entry; only n8n's request helpers are used. |
| No environment variables, no file system access | Yes: all inputs come from node parameters and the credential. |
| TypeScript, lint passes | Yes: `npm run lint` is clean in strict (n8n Cloud) mode. |
| English only (UI and docs) | Yes. |
| Repository URL, author and MIT license consistent between npm and GitHub | Yes (`package.json` `repository`, `author`, `license`). |
| Documentation with usage, examples and authentication details | Yes: README plus `examples/`. |
| Published from GitHub Actions with provenance | Yes: `.github/workflows/publish.yml`, see `docs/RELEASING.md`. Local `npm publish` is blocked. |
| `npx @n8n/scan-community-package @scoro/n8n-nodes-scoro` passes | To run after the first publish (the scanner downloads the package from npm); the same static checks run locally, see `testing/README.md`. |
| UX guidelines: Title Case labels, sentence-case descriptions, "e.g." placeholders, OAuth credential included, password fields for secrets | Yes. The package has no action node, so the operation naming and Simplify rules do not apply. |

## Before submitting

1. Release `v0.1.0` from `main` (`docs/RELEASING.md`) and confirm the provenance badge on npm.
2. Run `npx @n8n/scan-community-package @scoro/n8n-nodes-scoro` and keep the output.
3. Install the published package in a fresh n8n from the nodes panel and connect a credential once more.
4. Submit at <https://creators.n8n.io/nodes>. Reviews can take up to four weeks.
