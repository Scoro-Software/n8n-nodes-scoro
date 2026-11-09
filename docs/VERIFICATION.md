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
| Nodes | One regular node, **Scoro**, with three resources: **User → Get Me** (returns the connected user, company accounts, permissions and site settings), **Eli → Send Message** (sends a message to Eli, the Scoro AI agent that can do pretty much anything in the Scoro environment, and returns its answer, with conversation continuation through Options → Thread ID) and **Custom API Call → Send Request** (any API v4 endpoint: method, endpoint path, query parameters, headers, body). Every operation can override the credential's company account per call. Programmatic, usable as an AI tool. No trigger. |
| Credentials | **Scoro OAuth2 API**, usable from the HTTP Request node (Predefined Credential Type) to call any Scoro API v4 endpoint. |
| Description | Official Scoro package for n8n. Connect to Scoro with OAuth2, read the connected user, hand work to Eli, the Scoro AI agent, and call any Scoro API v4 endpoint with the Scoro node or the HTTP Request node. |
| Documentation | README in the repository and npm package: installation, Developer Portal setup, scopes, HTTP Request usage, the node's operations with their limits, example workflows, version history. |

## Checklist against n8n's verification guidelines

| Requirement | Status |
|---|---|
| Built with the `n8n-node` CLI scaffolding (`npm create @n8n/node`) | Yes. `@n8n/node-cli` is a dev dependency; lint, build, dev and release go through it. |
| Package name `@<scope>/n8n-nodes-*`, keyword `n8n-community-node-package`, `n8n` block with nodes and credentials | Yes (`package.json`). |
| One third-party service per package, no logic/flow nodes | Yes: Scoro only. |
| One regular node per package (plus an optional trigger), one codex file | Yes: a single programmatic `Scoro` node with resources and operations, `Scoro.node.json` as its codex file, no trigger. |
| Codex aliases limited to service-specific names | Yes: the only alias is `Eli`. |
| No runtime dependencies | Yes: no `dependencies` entry; only n8n's request helpers are used. |
| No environment variables, no file system access | Yes: all inputs come from node parameters and the credential. |
| TypeScript, lint passes | Yes: `npm run lint` is clean in strict (n8n Cloud) mode. |
| English only (UI and docs) | Yes. |
| Repository URL, author and MIT license consistent between npm and GitHub | Yes (`package.json` `repository`, `author`, `license`). |
| Documentation with usage, examples and authentication details | Yes: README plus `examples/`. |
| Published from GitHub Actions with provenance | Yes: `.github/workflows/publish.yml`, see `docs/RELEASING.md`. Local `npm publish` is blocked. |
| `npx @n8n/scan-community-package @scoro/n8n-nodes-scoro` passes | To run after the first publish (the scanner downloads the package from npm); the same static checks run locally, see `testing/README.md`. |
| UX guidelines: Title Case labels, sentence-case descriptions, "e.g." placeholders, OAuth credential included, password fields for secrets, resource/operation structure, optional fields in an Options collection | Yes. Resources Custom API Call, Eli and User, one operation each; the optional Thread ID and Company Account sit in Options. Custom API Call mirrors the HTTP Request node's fields (method, endpoint, name/value collections for query, headers and body, JSON body as an alternative). No Get Many operation, so the Simplify rule does not apply. |

## Review history

- **First review (0.4.0)**: rejected with three findings, all addressed in the next release.
  1. HIGH: two regular nodes in one package. Merged into the single Scoro node with resources and
     operations, one codex file.
  2. MEDIUM: generic codex aliases ("AI", "Agent", "Assistant", "Chat"). Only "Eli" remains.
  3. LOW: optional Thread ID at the top level of the form. Moved into an Options collection.

  After publishing the new version, confirm it in the Creator Portal so the review resumes.

## Before submitting

1. Release the next version from `main` (`docs/RELEASING.md`) and confirm the provenance badge on npm.
2. Run `npx @n8n/scan-community-package @scoro/n8n-nodes-scoro` and keep the output.
3. Install the published package in a fresh n8n from the nodes panel and connect a credential once more.
4. Submit at <https://creators.n8n.io/nodes>. Reviews can take up to four weeks.
