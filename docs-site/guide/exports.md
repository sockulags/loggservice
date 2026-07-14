# Exports & reports

Exports are the product's face toward the auditor. Both live in the **Export**
tab and as API endpoints.

## JSONL export — the verifiable one

`GET /api/export/jsonl?from=&to=`

One JSON object per line: every event (`{"type":"event",…}`) followed by
every signed checkpoint (`{"type":"checkpoint",…}`). This is the format the
[offline verifier](/guide/verification#offline-the-auditors-laptop) consumes,
and the format retention archives use.

```bash
clomp export --out clomp-2026-h1.jsonl --from 2026-01-01 --to 2026-06-30
node backend/scripts/verify-export.js clomp-2026-h1.jsonl
```

Hand the auditor the file and the verifier script; they need nothing else.

## PDF report — the readable one

`GET /api/export/report?from=&to=`

An A4 report designed to be handed over without editing
([sample](https://github.com/sockulags/clomp/blob/main/docs/sample-report.pdf)):

1. **Chain integrity** — `✔ INTACT — 1284 events verified against the hash
   chain`, or the exact break point; plus the latest signed checkpoint.
2. **Scheduled controls** — every declared control with its status
   (`on time` / `due` / `OVERDUE`), last-logged and next-due dates.
3. **Activity summary** — events per action, mapped to the SOC 2 criteria
   and NIS2 articles that action evidences. Actions outside the catalog are
   flagged for manual review.
4. **Event list** — sequence, action, actor, target, timestamps, hash.
5. **Evidence appendix** — every attachment with its SHA-256.

## Access

Any authenticated credential may export — including the read-only `auditor`
role, which exists precisely so an external auditor can pull exports and
nothing else.

::: warning Exports contain everything
Events, context and evidence hashes travel with the export. Treat export
files and the channel you deliver them over with the same care as the
database itself.
:::
