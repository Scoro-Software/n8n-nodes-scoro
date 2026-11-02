# Working on @scoro/n8n-nodes-scoro

This repository is an n8n community package for Scoro. It ships exactly two things and should stay
that small:

- `credentials/ScoroOAuth2Api.credentials.ts`: the **Scoro OAuth2 API** credential. Users call the
  Scoro API v4 through n8n's HTTP Request node with this credential (Predefined Credential Type).
- `nodes/Scoro/ScoroTrigger.node.ts`: the **Scoro Trigger** node (programmatic style), backed by
  Scoro webhooks. Shared request and error-mapping helpers live in `nodes/Scoro/shared/transport.ts`.

There is no action node on purpose. Do not add one, and do not add a hard-coded list of Scoro
modules or endpoints: the trigger takes the module as free text and derives API paths by convention.

## Rules that n8n verification enforces

- No runtime dependencies. Only `n8n-workflow` types and n8n's request helpers
  (`this.helpers.httpRequestWithAuthentication`). Never import `fs`, `path`, `child_process`,
  `axios` or similar, and never read `process.env`.
- TypeScript only, English only (parameter names, descriptions, errors, README).
- `npm run lint` must pass in strict (n8n Cloud) mode. Do not edit `eslint.config.mjs`; the lint
  verifies it is unchanged. Lint rules cover Title Case display names, sentence-case descriptions
  without a trailing period, "Whether …" for booleans, alphabetised options, `e.g.` placeholders,
  and `{ light, dark }` SVG icons.
- The credential's Scope field is user-editable. n8n drops a user-edited `scope` on credentials that
  extend `oAuth2Api` and re-applies the type's default, so the hidden `scope` property's default is
  the expression `={{ $self["scopes"] }}` reading the visible field. Default scope names come from
  the `security` entries of the Scoro API v4 schema (<https://api.scoro.com/api/v4/reference/openapi>).

## Commands

| Task | Command |
|---|---|
| Lint / fix | `npm run lint`, `npm run lint:fix` |
| Build | `npm run build` (compiles to `dist/`; copies every `*.svg`/`*.png` in the tree, so keep binaries out of the source folders) |
| Trigger handler checks | `node testing/scripts/trigger-harness.mjs` |
| Real n8n with the package installed | `./testing/setup.sh` (Docker, see `testing/README.md`) |
| What would be published | `npm pack --dry-run` |
| Release | `npm run release` from `main`, see `docs/RELEASING.md`; publishing happens only in GitHub Actions |

Run lint, build and the harness before committing. Commits follow the conventional format
(`feat(trigger): …`, `fix(credentials): …`, `docs(readme): …`).

## Facts about Scoro that shape the code

- OAuth endpoints are per site: `https://<site host>/auth/oauth/{authorize,token}`, where the host
  comes from the credential's Site URL and can be on scoro.com, scoro.ee, scoro.lv or scoro.lt.
  Developer Portal apps use authorization code with PKCE and always have a client secret; the
  credential uses n8n's `pkce` grant type with client ID and secret, sending them in the body.
- Webhooks: `POST/GET /api/v4/webhooks`, `DELETE /api/v4/webhooks/{id}`. Scoro probes the URL
  with a HEAD request before delivering, delivers only to public allow-listed hosts (never
  localhost), does not sign payloads, does not retry, and stores the `any` action as `null`.
  Deliveries carry `entityId`, `entityType`, `actorId` and a legacy snake_case `entity` snapshot.
- Lists are bare arrays paged with `page` (from 1) and `perPage` (max 100).
- Error bodies are `{ error, statusCode, message[] }`; the gateway answers missing scopes with
  `403 { error: "insufficient_scope", required_scope }`.

## Documentation to keep in sync

`README.md` (user-facing), `docs/RELEASING.md`, `docs/VERIFICATION.md` (Creator Portal submission),
`testing/README.md`, and the `examples/*.json` workflows, which must import into n8n without issues.
