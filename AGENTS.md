# Working on @scoro/n8n-nodes-scoro

This repository is an n8n community package for Scoro. It ships exactly two things and should stay
that small:

- `credentials/ScoroOAuth2Api.credentials.ts`: the **Scoro OAuth2 API** credential. Users call the
  Scoro API v4 through n8n's HTTP Request node with this credential (Predefined Credential Type).
- `nodes/Scoro/Scoro.node.ts`: the single **Scoro** node, with one codex file `Scoro.node.json`.
  Resources and operations:
  - **User → Get Me**: `GET /api/v4/users/me`.
  - **Eli → Send Message**: `POST /api/v4/ai/messages`, with the optional Thread ID inside an
    `Options` collection. Eli is the Scoro AI agent; describe it as able to do pretty much anything
    in the Scoro environment that the connected user could do (answer, look up, reason, carry out
    work), not as a read-only assistant.

Shared request and error-mapping helpers live in `nodes/Scoro/shared/transport.ts`. The node is
programmatic (`execute()`), runs once per input item, supports Continue On Fail, and is usable as an
AI tool.

n8n's verification guidelines allow one regular node per package (plus an optional trigger); the
first review of 0.4.0 rejected the package for shipping Scoro Get Me and Scoro Call Eli as two nodes,
for generic codex aliases ("AI", "Agent", "Assistant", "Chat"), and for an optional field outside an
Options collection. Keep to one node, Scoro-specific aliases only (`Eli`), and optional fields in
`Options`. There is no long list of Scoro operations on purpose, and no trigger (the Scoro Trigger
that shipped up to 0.3.0 was removed by maintainer decision in November 2026). Do not add either; the
HTTP Request node covers the rest of the API. n8n refuses a package without nodes (installer error
"The specified package does not contain any nodes", lint error on an empty `n8n.nodes`), which is why
the small node exists.

## Rules that n8n verification enforces

- No runtime dependencies. Only `n8n-workflow` types and n8n's request helpers
  (`this.helpers.httpRequestWithAuthentication`). Never import `fs`, `path`, `child_process`,
  `axios` or similar, and never read `process.env`.
- TypeScript only, English only (parameter names, descriptions, errors, README).
- `npm run lint` must pass in strict (n8n Cloud) mode. Do not edit `eslint.config.mjs`; the lint
  verifies it is unchanged. Lint rules cover Title Case display names, sentence-case descriptions
  without a trailing period, "Whether …" for booleans, alphabetised options, `e.g.` placeholders,
  `{ light, dark }` SVG icons, `usableAsTool` and `subtitle` on every node, `pairedItem` on every
  output item, and no bare `throw error` of a catch parameter (wrap in `NodeOperationError`).
- The credential's Scope field is user-editable. n8n drops a user-edited `scope` on credentials that
  extend `oAuth2Api` and re-applies the type's default (n8n 1.x and 2.0 always; 2.45 only when the
  `scope` property is hidden), so the hidden `scope` property's default is the expression
  `={{ $self["scopes"] }}` reading the visible field. Default scope names come from the `security`
  entries of the Scoro API v4 schema (<https://api.scoro.com/api/v4/reference/openapi>).

## Commands

| Task | Command |
|---|---|
| Lint / fix | `npm run lint`, `npm run lint:fix` |
| Build | `npm run build` (compiles to `dist/`; copies every `*.svg`/`*.png` in the tree, so keep binaries out of the source folders) |
| Node checks with a stub context | `node testing/scripts/nodes-harness.mjs` (after a build) |
| Real n8n with the package installed | `./testing/setup.sh` (Docker, see `testing/README.md`) |
| What would be published | `npm pack --dry-run` |
| Release | `npm run release` from `main`, see `docs/RELEASING.md`; publishing happens only in GitHub Actions |

Run lint, build and the harness before committing. Commits follow the conventional format
(`feat(nodes): …`, `fix(credentials): …`, `docs(readme): …`).

## Facts about Scoro that shape the code

- OAuth endpoints are per site: `https://<site host>/auth/oauth/{authorize,token}`, where the host
  comes from the credential's Site URL and can be on scoro.com, scoro.ee, scoro.lv or scoro.lt.
  Developer Portal apps use authorization code with PKCE and always have a client secret; the
  credential uses n8n's `pkce` grant type with client ID and secret, sending them in the body.
- `GET /users/me` needs `base:r`, which every token has. It returns the `accounts` identifiers used
  by the `Scoro-Company-Account` header, which `transport.ts` adds when the credential names one.
- `POST /ai/messages` needs `ai:rw`, takes `{ message, threadId? }`, answers synchronously ("can
  take a minute or more", so the node sets a 300 s timeout) with `{ threadId, messageId, response,
  createdDateTime, isNewThread }`, and documents `403` (assistant not enabled), `409` (same question
  already being answered, do not retry), `502` and `504` (stored in the thread, ask again there).
  `GET /ai/threads` lists conversations.
- Lists are bare arrays paged with `page` (from 1) and `perPage` (max 100).
- Error bodies are `{ error, statusCode, message[] }`; the gateway answers missing scopes with
  `403 { error: "insufficient_scope", required_scope }`.

## Documentation to keep in sync

`README.md` (user-facing), `docs/RELEASING.md`, `docs/VERIFICATION.md` (Creator Portal submission),
`testing/README.md`, and the `examples/*.json` workflows, which must import into n8n without issues.
