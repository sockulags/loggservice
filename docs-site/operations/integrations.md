# Integrations

clomp integrates outward through three deliberately simple mechanisms: a
GitHub Action for recording, webhooks for forwarding, and email for
reminders. No plugin system, no agents.

## GitHub Action: record from CI

Log deploys, patches and pipeline activities as chain events:

```yaml
- name: Record the deploy in the audit trail
  uses: sockulags/clomp/.github/actions/record@main
  with:
    api-url: https://clomp.example.com
    api-key: ${{ secrets.CLOMP_API_KEY }}
    action: patch.applied
    actor: service:github-actions
    target: system:web-01
    context: '{"sha": "${{ github.sha }}", "run": "${{ github.run_id }}"}'
```

The API key comes from an admin (**Admin → API keys**) and belongs in a
repository secret.

## Outgoing event webhooks

POST every appended event to your endpoint — the hook for Slack relays,
SIEM forwarding and automations:

```bash
EVENT_WEBHOOK_URL=https://hooks.example.com/clomp
EVENT_WEBHOOK_TOKEN=optional-bearer-token
# forward only some actions (prefix match); empty = everything
EVENT_WEBHOOK_ACTIONS=incident.,retention.,control.
```

Delivery is fire-and-forget with a 10-second timeout: an unreachable
receiver never fails or slows down recording, and there is no retry queue —
the [export API](/guide/exports) is the source of truth, webhooks are a
convenience signal. The payload is the event JSON with `"type": "event"`.

## Overdue-control email digest

The passive complement to `clomp schedules --fail-on-overdue`: a daily
email when scheduled controls slip, silent when everything is on time.

```bash
NOTIFY_EMAIL_TO=ciso@example.com
NOTIFY_SCHEDULE=0 6 * * *      # cron, UTC
NOTIFY_INCLUDE_DUE=false       # true: also controls in their grace period
# uses the same SMTP_* settings as external anchoring
```

## API clients in other languages

The [OpenAPI 3.1 specification](/openapi.yaml) covers the full REST
surface — generate a client, or just read it. Recording an event is a
single authenticated POST; see the [REST API reference](/reference/rest-api).
