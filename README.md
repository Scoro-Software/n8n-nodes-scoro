# @scoro/n8n-nodes-scoro

The official [n8n](https://n8n.io/) community package for the [Scoro](https://www.scoro.com) API v4.

It adds two things to n8n:

- **Scoro OAuth2 API** credential. Connect once with OAuth2, then call any Scoro API v4 endpoint from
  n8n's HTTP Request node (Authentication: *Predefined Credential Type*). n8n attaches the token and
  refreshes it with the refresh token, as it does for its built-in OAuth2 credentials.
- **Scoro** node with two resources:
  - **User → Get Me** returns the user the credential is connected as, with the company accounts,
    permissions and site settings a workflow needs before calling other endpoints.
  - **Eli → Send Message** sends a message to Eli, the Scoro AI agent, and returns its answer. Eli
    can do pretty much anything in your Scoro environment that you could do yourself: answer
    questions, look up and reason over data across modules, and carry out work on your behalf.
    Conversations can be continued across calls.

There is deliberately no long list of operations in the node: the credential plus the HTTP Request
node covers the whole API without the package having to track every endpoint.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Credentials](#credentials)
[Calling the API](#calling-the-api)
[Scoro node](#scoro-node)
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
4. Open **Manage access** and grant the scopes you will request from n8n (see below). Scoro
   silently narrows a token to what the app allows, so missing scopes show up later as `403` errors.
5. Save and click **Generate OAuth credentials**. Copy the **OAuth Client ID** and the secret
   (shown once).
6. In n8n, create a **Scoro OAuth2 API** credential:
   - **Client ID** and **Client Secret** from the previous step.
   - **Site URL**: the address of your site, `https://mycompany.scoro.com` or
     `https://mycompany.scoro.ee`. Only the host is used.
   - **Company Account** (optional): on a site with several company accounts, the identifier of the
     account to work in. The identifiers are listed under `accounts` in the output of the Scoro
     node's User → Get Me operation.
7. Click **Connect my account**, sign in to Scoro and approve the scopes.

### Scopes

The credential has an editable **Scope** field (space-separated). Its default covers what the package
can do out of the box:

```
offline_access ai:rw
projects:rwd tasks:rwd contacts:rwd quotes:rwd orders:rwd invoices:rwd products:rwd
bills:r bookings:r calendar:r expenses:r prepayments:r purchase-orders:r time-offs:r
```

`ai:rw` is needed by the Eli resource of the Scoro node, read/write/delete on the core resources makes
the credential useful from the HTTP Request node, and the read scopes cover the remaining modules.
User → Get Me only needs `base:r`, which is granted automatically. Trim or extend the list to what
your workflows need; scope names are the ones the
[API reference](https://api.scoro.com/api/v4/reference) lists per operation (`resource:r`, `:rw`,
`:rwd`). Keep `offline_access`, otherwise no refresh token is issued.
`contacts:*` covers companies and persons; `tasks:*` covers time entries.

The Developer Portal app must allow every scope you request: Scoro silently narrows the token to the
app's Manage access list. Changing the Scope field requires reconnecting the credential.

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
  yourself in the HTTP Request node. The Scoro node sends it for you when the credential names a
  company account.
- Errors are JSON with `error`, `statusCode` and `message` fields. A `403` with
  `insufficient_scope` means the Developer Portal app lacks a scope; add it and reconnect the
  credential.

Full reference: <https://api.scoro.com/api/v4/reference>.

## Scoro node

The node has a **Resource** and an **Operation** parameter. Both operations run once per input item,
so put the node after a trigger or set *Execute Once* in the node settings when the input has many
items. The node can be used as a tool by n8n's AI Agent node.

### User → Get Me

Calls `GET /api/v4/users/me` and outputs the user the credential is connected as. The operation has
no further parameters. Useful fields:

| Field | Meaning |
|---|---|
| `id`, `firstName`, `lastName`, `email`, `roleName`, `groupIds` | Who the token belongs to |
| `accounts` | Company account identifiers the user can work in, for the credential's Company Account field or the `Scoro-Company-Account` header |
| `enabledPermissions` | What the user may do, as `module.permission` strings |
| `baseCurrency`, `dateFormat`, `timeFormat`, `thousandSeparator`, `decimalSeparator`, `timezone`, `languageId` | Site and user formatting settings |

### Eli → Send Message

Calls `POST /api/v4/ai/messages`. Eli is the Scoro AI agent: give it a message in natural language and
it can do pretty much anything in your Scoro environment that you could do yourself, from answering a
question and looking up or reasoning over data across modules to carrying out work on your behalf.
Eli acts as the user who connected the credential, within that user's permissions.

| Parameter | Meaning |
|---|---|
| **Message** | What Eli should answer or do, in natural language, up to 10,000 characters. |
| **Options → Thread ID** | Leave unset to start a new conversation. Pass the `threadId` of an earlier answer to continue that conversation with its full history. |

The output is Eli's answer: `response` (the text), `threadId`, `messageId`, `createdDateTime` and
`isNewThread`. Use an expression such as `{{ $json.threadId }}` as the Thread ID of a following Send
Message operation to continue with a follow-up message.

Things to know:

- The call is synchronous and can take a minute or more; the node waits up to five minutes.
- Eli must be enabled for the site and for the user who connected the credential, and
  the credential needs the `ai:rw` scope. Otherwise the node fails with a `403`.
- A `409` means the same question is already being answered: do not retry, continue the conversation
  named in the error details instead. A `504` means Eli did not answer in time; the question is
  stored in that conversation, ask again there to get the answer.
- Answers may be shorter when the site's monthly AI allowance is exhausted.
- `GET /api/v4/ai/threads` (through the HTTP Request node) lists your conversations, with their
  `threadId`, when you need to find one to continue.

## Example workflows

Importable JSON exports are in [`examples/`](examples/):

- [`list-projects.json`](examples/list-projects.json): a manual trigger and an HTTP Request node that
  lists projects through the Scoro credential.
- [`get-me.json`](examples/get-me.json): a manual trigger and the Scoro node with User → Get Me.
- [`call-eli.json`](examples/call-eli.json): a manual trigger, a message to Eli, and a follow-up
  in the same conversation (Eli → Send Message twice, with Thread ID on the second).

After importing, select your credential in each node and replace `yoursite` in URLs.

## Compatibility

Tested with n8n 2.45 (self-hosted, Docker); earlier n8n versions are untested. Scoro API v4 only;
API v2 is not supported.

## Resources

- [Scoro API v4 reference](https://api.scoro.com/api/v4/reference)
- [Scoro Developer Portal](https://developers.scoro.com)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Releasing this package](docs/RELEASING.md)

## Version history

- **Unreleased**: the Scoro Get Me and Scoro Call Eli nodes are merged into a single **Scoro** node
  with a User resource (Get Me) and an Eli resource (Send Message), as n8n's verification
  guidelines allow one regular node per package. Thread ID moved into the Options collection.
  Workflows built with 0.4.0 need the node replaced.
- **0.4.0**: the Scoro Trigger node is removed; workflows that use it stop loading after the
  update. New nodes Scoro Get Me and Scoro Call Eli. The default Scope list now includes `ai:rw` and
  no longer includes `webhooks:rwd` (saved credentials keep their own list).
- **0.3.0 and earlier**: Scoro OAuth2 API credential and Scoro Trigger.

## License

[MIT](LICENSE)
