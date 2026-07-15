# Scheduled controls

The hash chain proves that recorded history is genuine. It cannot know about
events that were **never recorded**. Scheduled controls close that gap: you
declare how often an activity must be logged, and clomp surfaces what is
missing.

> "Access reviews quarterly, restore tests monthly, security training yearly."

## How status is computed

A schedule binds an **action** to a **frequency** (`daily`, `weekly`,
`monthly`, `quarterly`, `yearly`) with optional **grace days**.

- The clock starts at the latest event with a matching action — or at the
  schedule's creation date if the action has never been logged.
- `next_due` = last occurrence + one frequency interval.
- Past `next_due` but within grace → status **due**.
- Past the grace deadline → status **overdue**.

Overdue controls appear:

- in the **Schedules** tab, with a red badge and a summary line,
- in the **PDF report**, as a "Scheduled controls" section an auditor reads
  first (`✘ 1 of 4 scheduled control(s) overdue`),
- in the **CLI**, monitoring-friendly:

```bash
clomp schedules --fail-on-overdue   # exit code 1 if anything is overdue
```

Run that from cron or CI and route the failure to your alerting — or let
clomp push instead: set `NOTIFY_EMAIL_TO` and a daily digest is mailed
whenever controls are overdue (silent on green days). See
[Integrations](/operations/integrations#overdue-control-email-digest).

## The schedule is part of the audit trail

Changes to the control plan alter what the trail *promises to contain*, so
they are themselves chain events: creating, updating or removing a schedule
appends `control.schedule.created` / `.updated` / `.removed` to the ledger.
An auditor can see when a control was added, relaxed or removed — and by
whom.

For the same reason, schedule changes require a signed-in `admin` or
`editor`; API keys can read schedules but never modify them.

## API

```bash
# list with computed status
curl -H "X-API-Key: ..." https://clomp.example.com/api/schedules

# create (session cookie required)
curl -X POST https://clomp.example.com/api/schedules \
  -H "Content-Type: application/json" -b "clomp_session=..." \
  -d '{"action":"access.review.completed","title":"Quarterly access review","frequency":"quarterly","grace_days":14}'
```

See the [REST API reference](/reference/rest-api#schedules) for the full
surface.
