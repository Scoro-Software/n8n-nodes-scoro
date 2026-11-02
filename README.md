# @scoro/n8n-nodes-scoro

The official [n8n](https://n8n.io/) community package for the [Scoro](https://www.scoro.com) API v4.

It adds two things to n8n:

- **Scoro OAuth2 API** credential. Connect once with OAuth2, then call any Scoro API v4 endpoint from
  n8n's HTTP Request node (Authentication: *Predefined Credential Type*). n8n attaches the token and
  refreshes it with the refresh token, as it does for its built-in OAuth2 credentials.
- **Scoro Trigger** node. Starts a workflow when a record is created, modified or deleted in Scoro,
  using Scoro webhooks.

There is deliberately no action node with a fixed list of operations: the credential plus the HTTP
Request node covers the whole API without the package having to track every endpoint.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Credentials](#credentials)
[Calling the API](#calling-the-api)
[Scoro Trigger](#scoro-trigger)
[Example workflows](#example-workflows)
[Compatibility](#compatibility)
[Resources](#resources)
[Version history](#version-history)

## Installation

**Self-hosted (nodes panel):** open *Settings → Community nodes → Install*, enter
`@scoro/n8n-nodes-scoro` and confirm. See the
[community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).
On n8n Cloud the package becomes installable from the nodes panel once n8n has verified it.

**Self-hosted (command line):**

```bash
cd ~/.n8n/nodes
npm install @scoro/n8n-nodes-scoro
```

then restart n8n.

## Credentials

The package authenticates with OAuth2 against your own Scoro site. You need an app in the
[Scoro Developer Portal](https://developers.scoro.com).

1. Sign in to the Developer Portal and create an app. Choose the **OAuth** (API v4) authentication
   type. A **private** app works on up to three sites you list and needs no review.
2. Add the n8n callback URL under **Callback URLs**:

   ```
   https://<your-n8n-host>/rest/oauth2-credential/callback
   ```

   The exact value is shown as *OAuth Redirect URL* in the n8n credential dialog.
3. Add your Scoro site under **Site URLs**, for example `https://mycompany.scoro.com`. Sites on the
   regional domains (`scoro.ee`, `scoro.lv`, `scoro.lt`) work the same way.
4. Open **Manage access** and grant at least the scopes the credential requests (see below).
   Scoro silently narrows a token to what the app allows, so missing scopes show up later as
   `403` errors.
5. Save and click **Generate OAuth credentials**. Copy the **OAuth Client ID** and the secret
   (shown once).
6. In n8n, create a **Scoro OAuth2 API** credential:
   - **Client ID** and **Client Secret** from the previous step.
   - **Site URL**: the address of your site, `https://mycompany.scoro.com` or
     `https://mycompany.scoro.ee`. Only the host is used.
   - **Company Account** (optional): on a site with several company accounts, the identifier of the
     account to work in. The identifiers are listed under `accounts` in `GET /api/v4/users/me`.
7. Click **Connect my account**, sign in to Scoro and approve the scopes.

### Scopes

The credential requests a fixed scope list:

```
offline_access
projects:rwd tasks:rwd contacts:rwd quotes:rwd orders:rwd invoices:rwd products:rwd
webhooks:rwd
bills:r bookings:r calendar:r expenses:r prepayments:r purchase-orders:r time-offs:r
```

Read/write/delete on the core resources makes the credential useful from the HTTP Request node,
`webhooks:rwd` is needed by the trigger, and the read scopes let the trigger fetch records of the
remaining modules. `base:r` (reference data such as statuses and `/users/me`) is granted
automatically. `contacts:*` covers companies and persons; `tasks:*` covers time entries.

If you only need part of this, grant only that part in the Developer Portal: the token then holds
the intersection.

## Calling the API

1. Add an **HTTP Request** node.
2. Set **Authentication** to *Predefined Credential Type*, **Credential Type** to *Scoro OAuth2 API*,
   and pick your credential.
3. Use URLs of the form `https://<your site>/api/v4/...`, for example
   `https://mycompany.scoro.com/api/v4/projects?perPage=50` (or `.scoro.ee`, `.scoro.lv`, `.scoro.lt`).

Things worth knowing about the API:

- Lists are plain arrays with `page` (from 1) and `perPage` (max 100) query parameters; the end of
  a list is a page shorter than `perPage`.
- Filters use bracket syntax: `filters[ids][]=1&filters[ids][]=2`,
  `filters[createdDateTime][from]=2026-01-01T00:00:00Z`.
- On a site with several company accounts, send the `Scoro-Company-Account: <identifier>` header
  yourself in the HTTP Request node.
- Errors are JSON with `error`, `statusCode` and `message` fields. A `403` with
  `insufficient_scope` means the Developer Portal app lacks a scope; add it and reconnect the
  credential.

Full reference: <https://api.scoro.com/api/v4/reference>.

## Scoro Trigger

The trigger registers a webhook subscription with Scoro when the workflow is activated and removes
it when the workflow is deactivated.

| Parameter | Meaning |
|---|---|
| **Module** | What to watch, named as in the Scoro webhooks API: `tasks`, `projects`, `companies`, `persons`, `quotes`, `orders`, `invoices`, `bills`, `expenses`, `purchaseOrders`, `calendar`, `bookings`, `timeoff`, or the path of a custom module. |
| **Event** | *Created*, *Modified*, *Deleted* or *Any Change*. |
| **Return Full Record** | On (default): the output is the current record read from the API v4 (`/api/v4/<module in kebab-case>/<id>`), with camelCase fields. Off: the output is the webhook payload as Scoro sends it, whose `entity` snapshot uses older snake_case field names. Deleted records are always returned as delivered. |
| **Options** | *Actors* and *Owners* (user IDs, `me`, `any` or one `group_<id>`), *Fields* to watch on modify, *Relation Type* with *Bookmark ID*, and *Record Endpoint* for modules whose API path is not the kebab-case module name (for example `/time-offs/{ID}` for `timeoff`). |

Every output item carries a `webhook` object with `module`, `action`, `entityId`, `entityType` and
`actorId`, plus `recordFetchError` when the record could not be read and the delivered payload was
returned instead.

Two constraints come from Scoro, not from n8n:

- **Scoro delivers only to public, allow-listed hosts.** Registering a `localhost` URL fails with
  "The provided URL is missing or malformed". Common automation hosts are allowed already; for an
  n8n instance on your own domain, serve `https://<host>/scoro.txt` or publish a DNS TXT record
  with the value `scoro.txt` on that host (see the Webhooks section of the API guide).
- **Deliveries are not signed and not retried.** The unguessable n8n webhook URL is the only
  protection against forged events, and an unreachable n8n misses the event. Keep a periodic poll
  for anything you cannot afford to miss.

## Example workflows

Importable JSON exports are in [`examples/`](examples/):

- [`list-projects.json`](examples/list-projects.json): a manual trigger and an HTTP Request node that
  lists projects through the Scoro credential.
- [`task-created.json`](examples/task-created.json): a Scoro Trigger on created tasks that picks the
  fields a notification needs.
- [`fetch-record-manually.json`](examples/fetch-record-manually.json): a Scoro Trigger with *Return
  Full Record* off, followed by an HTTP Request that reads the record itself.

After importing, select your credential in each node and replace `yoursite` in URLs.

## Compatibility

Tested with n8n 2.45 (self-hosted, Docker); earlier n8n versions are untested. The trigger needs an
n8n reachable from the internet (see above). Scoro API v4 only; API v2 is not supported.

## Resources

- [Scoro API v4 reference](https://api.scoro.com/api/v4/reference)
- [Scoro Developer Portal](https://developers.scoro.com)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Releasing this package](docs/RELEASING.md)

## Version history

- **0.1.0**: first release. Scoro OAuth2 API credential and Scoro Trigger.

## License

[MIT](LICENSE)
