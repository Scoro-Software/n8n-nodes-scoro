# Local testing

Everything needed to try the package in a real n8n, the way a user would: a Docker n8n with the
packed node installed, a replay of a real Scoro webhook delivery, and a harness for the trigger's
webhook handler.

## 1. Start n8n with the node installed

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
   and set Manage access to at least the scopes in `credentials/ScoroOAuth2Api.credentials.ts`.
3. In n8n, create a **Scoro OAuth2 API** credential: Client ID, Client Secret, Site URL such as
   `https://mycompany.scoro.com` or `https://mycompany.scoro.ee` (and Company Account on a
   multi-entity site), Save, then **Connect my account** and approve.

## 3. Calling the API: HTTP Request node

The package ships no action node on purpose. Add an **HTTP Request** node, set
Authentication to **Predefined Credential Type**, choose **Scoro OAuth2 API**, and call any
endpoint under `https://<site>.scoro.com/api/v4/`, for example `GET .../api/v4/projects?perPage=5`.
n8n adds the Bearer token and refreshes it. On a multi-entity site add a
`Scoro-Company-Account` header yourself.

## 4. Trigger node

`Scoro Trigger` registers a webhook subscription with Scoro when the workflow is activated (or
when you click "Execute step" to listen for a test event) and removes it on deactivation. The
Module is free text (`tasks`, `projects`, `purchaseOrders`, a custom module path, ...), so new
Scoro modules need no package update. "Return Full Record" reads the record from
`/api/v4/<module in kebab-case>/{id}`; set the Record Endpoint option when the API path differs
(for example `/time-offs/{ID}` for `timeoff`).

Scoro only accepts public, allow-listed URLs. With n8n on localhost the registration is rejected
with "The provided URL is missing or malformed", shown in n8n as "Scoro rejected the request as
invalid". To test end to end you need n8n reachable on a public HTTPS host (set `WEBHOOK_URL` in
`testing/docker-compose.yml`); for your own domain Scoro also requires `https://<host>/scoro.txt`
or a DNS TXT record, see the Webhooks section of the API guide.

What can be tested without a public host:

```bash
npm run build && node testing/scripts/trigger-harness.mjs
```

runs the compiled `webhook()` handler against `testing/fixtures/webhook-task-created.json`
(an anonymised copy of a real delivery) and checks the HEAD probe answer, the record fetch, the
raw fallback, the deleted-record case and the fetch-failure case.

`testing/scripts/simulate-webhook.sh <webhook-url>` replays the same delivery the way Scoro
sends it (HEAD probe, then a JSON POST with Scoro's User-Agent) against any webhook URL of a
listening trigger, once registration is possible.

## 5. Evidence screenshots

UI screenshots taken during testing go to `testing/evidence/` (git-ignored). Save them as JPEG:
`n8n-node build` copies every `*.png` and `*.svg` in the project into `dist/`, so PNG screenshots
would end up in a locally packed tarball. `npm pack --dry-run` (also run in CI) shows what ships.

## 6. What has been verified (n8n 2.45.7, 2026-11-02)

- Package installs under `~/.n8n/nodes` and shows up as "Scoro · Installed · Via npm" with the
  four trigger events.
- OAuth2 connect succeeds against a trial site; the credential appears under HTTP Request >
  Predefined Credential Type as "Scoro OAuth2 API" and attaches automatically. A
  `GET https://<site>.scoro.com/api/v4/projects?perPage=5` through that node returned 5 projects.
- Before the package was scoped down to credential + trigger, the generated action node was used
  to prove the credential works at runtime: list calls paged through 247 tasks, limits of 5 and
  150 were exact, and an `ids` filter was encoded correctly.
- Trigger registration from localhost is rejected by Scoro (expected); the mapped error is
  readable. The handler itself passes the harness.
