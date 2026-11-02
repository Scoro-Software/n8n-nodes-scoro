#!/usr/bin/env bash
# Replays a Scoro webhook delivery against a Scoro Trigger webhook URL, the way Scoro does it:
# a HEAD probe first, then a JSON POST with Scoro's User-Agent.
#
#   testing/scripts/simulate-webhook.sh <webhook-url> [fixture.json]
#
# Use the "Test URL" shown on the Scoro Trigger node while "Listen for test event" is active,
# or the production URL of an active workflow. Scoro itself only delivers to allow-listed
# hosts, so this script is how the trigger is exercised on localhost.
set -euo pipefail

URL="${1:?usage: simulate-webhook.sh <webhook-url> [fixture.json]}"
FIXTURE="${2:-$(dirname "${BASH_SOURCE[0]}")/../fixtures/webhook-task-created.json}"
UA='Scoro/1.0 Webhook (+https://www.scoro.com)'

echo "==> HEAD $URL"
curl -sS -I -A "$UA" -o /dev/null -w 'HTTP %{http_code}\n' "$URL"

echo "==> POST $URL ($(basename "$FIXTURE"))"
curl -sS -X POST -A "$UA" -H 'Content-Type: application/json' -H 'Accept: */*' \
  -H "x-request-id: $(uuidgen 2>/dev/null || date +%s)" \
  --data-binary "@$FIXTURE" -w '\nHTTP %{http_code}\n' "$URL"
