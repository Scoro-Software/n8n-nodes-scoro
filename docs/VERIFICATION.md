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
| Authentication | OAuth2 (authorization code with PKCE) against the customer's own Scoro site, using an app registered in the Scoro Developer Portal. Editable scope list with a documented default. |
| Nodes | **Scoro Get Me** (returns the connected user, company accounts, permissions and site settings) and **Scoro Call Eli** (sends a message to Eli, the Scoro AI agent that can do pretty much anything in the Scoro environment, and returns its answer, with conversation continuation). Both programmatic, usable as AI tools. |
| Credentials | **Scoro OAuth2 API**, usable from the HTTP Request node (Predefined Credential Type) to call any Scoro API v4 endpoint. |
| Description | Official Scoro package for n8n. Connect to Scoro with OAuth2, call the Scoro API v4 from the HTTP Request node, read the connected user with Scoro Get Me, and hand work to Eli, the Scoro AI agent, with Scoro Call Eli. |
| Documentation | README in the repository and npm package: installation, Developer Portal setup, scopes, HTTP Request usage, both nodes with their limits, example workflows, version history. |

## Checklist against n8n's verification guidelines

| Requirement | Status |
|---|---|
| Built with the `n8n-node` CLI scaffolding (`npm create @n8n/node`) | Yes. `@n8n/node-cli` is a dev dependency; lint, build, dev and release go through it. |
| Package name `@<scope>/n8n-nodes-*`, keyword `n8n-community-node-package`, `n8n` block with nodes and credentials | Yes (`package.json`). |
| One third-party service per package, no logic/flow nodes | Yes: Scoro only; two programmatic action nodes, no trigger. |
| No runtime dependencies | Yes: no `dependencies` entry; only n8n's request helpers are used. |
| No environment variables, no file system access | Yes: all inputs come from node parameters and the credential. |
| TypeScript, lint passes | Yes: `npm run lint` is clean in strict (n8n Cloud) mode. |
| English only (UI and docs) | Yes. |
| Repository URL, author and MIT license consistent between npm and GitHub | Yes (`package.json` `repository`, `author`, `license`). |
| Documentation with usage, examples and authentication details | Yes: README plus `examples/`. |
| Published from GitHub Actions with provenance | Yes: `.github/workflows/publish.yml`, see `docs/RELEASING.md`. Local `npm publish` is blocked. |
| `npx @n8n/scan-community-package @scoro/n8n-nodes-scoro` passes | To run after the first publish (the scanner downloads the package from npm); the same static checks run locally, see `testing/README.md`. |
| UX guidelines: Title Case labels, sentence-case descriptions, "e.g." placeholders, OAuth credential included, password fields for secrets | Yes. Each node has a single purpose, so the resource/operation and Simplify rules do not apply. |

## Before submitting

1. Release the next version from `main` (`docs/RELEASING.md`) and confirm the provenance badge on npm.
2. Run `npx @n8n/scan-community-package @scoro/n8n-nodes-scoro` and keep the output.
3. Install the published package in a fresh n8n from the nodes panel and connect a credential once more.
4. Submit at <https://creators.n8n.io/nodes>. Reviews can take up to four weeks.
