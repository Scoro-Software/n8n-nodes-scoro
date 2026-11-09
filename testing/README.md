# Local testing

Everything needed to try the package in a real n8n, the way a user would: a Docker n8n with the
packed package installed, and a harness that runs the Scoro node with a stub context.

## 1. Start n8n with the package installed

```bash
./testing/setup.sh            # build, pack, start n8n on http://localhost:5678
./testing/setup.sh --fresh    # same, but wipe n8n data first
```

The compose file installs `testing/pkg/package.tgz` into `/home/node/.n8n/nodes` on every start,
which is the directory n8n uses for community nodes installed from the nodes panel. Peer
dependencies are skipped (`--legacy-peer-deps`), mirroring n8n's own installer; without that npm
pulls in `n8n-workflow` and a native build of `isolated-vm` that fails in the image.

Useful commands:

```bash
docker compose -f testing/docker-compose.yml logs -f
docker compose -f testing/docker-compose.yml down       # -v also deletes n8n data
```

## 2. One-time setup in the n8n UI

1. Open http://localhost:5678 and create the owner account. Keep the values in `testing/.env`
   (copy `testing/.env.example`); the file is git-ignored.
2. In your Scoro Developer Portal app (private app, OAuth authentication), add the callback URL
   `http://localhost:5678/rest/oauth2-credential/callback`, list your trial site under Site URLs,
   and set Manage access to at least the scopes in `credentials/ScoroOAuth2Api.credentials.ts`
   (`ai:rw` for the Eli resource).
3. In n8n, create a **Scoro OAuth2 API** credential: Client ID, Client Secret, Site URL such as
   `https://mycompany.scoro.com` or `https://mycompany.scoro.ee` (and Company Account on a
   multi-entity site), Save, then **Connect my account** and approve.

## 3. Calling the API: HTTP Request node

Add an **HTTP Request** node, set Authentication to **Predefined Credential Type**, choose
**Scoro OAuth2 API**, and call any endpoint under `https://<site>/api/v4/`, for example
`GET .../api/v4/projects?perPage=5`. n8n adds the Bearer token and refreshes it. On a multi-entity
site add a `Scoro-Company-Account` header yourself.

## 4. The Scoro node

- **User → Get Me**: no further parameters; "Execute step" returns the connected user. Check
  `accounts`, `enabledPermissions` and `baseCurrency` are present.
- **Eli → Send Message**: Eli is the Scoro AI agent and can act in the site, so on a shared site ask
  something harmless such as "How many open tasks do I have?". The answer arrives after a few
  seconds to a minute; `threadId` in the output continues the conversation when passed as
  Options → Thread ID to a second Scoro node. A `403` with `insufficient_scope` means the app or the
  credential's Scope field lacks `ai:rw`; a plain `403` means the assistant is not enabled for the
  user or site.
- **Custom API Call → Send Request**: `GET` with endpoint `/projects` and query parameter `perPage`
  = `3` should output three items (one per project). `GET /projects/999999` should fail with "The
  Scoro record was not found". A `POST` to `/projects/<id>/comments` with body field `comment`
  creates a comment on that project.

All operations run once per input item. On a multi-entity site, set **Options → Company Account**
to another account identifier from Get Me's `accounts` and check that the output changes.

What can be tested without a Scoro site:

```bash
npm run build && node testing/scripts/nodes-harness.mjs
```

runs the compiled `execute()` of the node for all three operations against a stub context and checks
the URLs, headers, request bodies, the Thread ID and Company Account options, timeout, `pairedItem`,
Continue On Fail, the mapped error messages (401, 403 with and without a missing scope, 404, 409,
500, 504), the Custom API Call URL and body building, list splitting, empty responses, and the errors
for an invalid JSON body, an empty endpoint and an unknown operation.

## 5. Evidence screenshots

UI screenshots taken during testing go to `testing/evidence/` (git-ignored). Save them as JPEG:
`n8n-node build` copies every `*.png` and `*.svg` in the project into `dist/`, so PNG screenshots
would end up in a locally packed tarball. `npm pack --dry-run` (also run in CI) shows what ships.

## 6. What has been verified (n8n 2.45.7, 2026-11-03, with the separate Get Me and Call Eli nodes)

The checks below were made with 0.4.0, before the two nodes were merged into the single Scoro node.
The requests and error mapping are unchanged (the harness covers them); the merged node has not yet
been exercised in a real n8n.

- Package installs under `~/.n8n/nodes`; both nodes show up in the nodes panel as "Scoro Get Me"
  and "Scoro Call Eli" (plus their auto-generated AI tool variants), with the credential attached.
- OAuth2 connect succeeds against a trial site; the credential appears under HTTP Request >
  Predefined Credential Type as "Scoro OAuth2 API" and attaches automatically. A
  `GET https://<site>.scoro.com/api/v4/projects?perPage=5` through that node returned 5 projects.
- Scoro Get Me: "Execute workflow" and "Execute step" both return the connected user in about a
  second (`enabledPermissions`, `accounts`, `baseCurrency`, formats present).
- Scoro Call Eli: with a token that lacks `ai:rw` the node fails with the mapped error
  "The connected Scoro app does not have the \"ai:rw\" scope". A successful answer has not been
  observed yet; it needs `ai:rw` under Manage access of the Developer Portal app, in the
  credential's Scope field, and a reconnect.
