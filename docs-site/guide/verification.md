# Verification

Verification recomputes the hash chain and answers one question: **is the
recorded history exactly what was recorded?** If not, it pinpoints the first
broken sequence number.

## Online: `GET /api/verify`

```bash
curl -H "X-API-Key: clomp_live_..." https://clomp.example.com/api/verify
```

```json
{
  "intact": true,
  "verified": 1284,
  "checkpoint": { "sequence": 1280, "signed_at": "2026-07-14T02:00:00.000Z", "signature_valid": true }
}
```

On a tampered chain:

```json
{
  "intact": false,
  "verified": 6,
  "firstBreak": 7,
  "reason": "hash mismatch"
}
```

The response also validates the latest checkpoint's Ed25519 signature. If
history has been [retention-pruned](/operations/retention), the verification
anchors at the signed checkpoint instead of genesis and reports it:

```json
{ "intact": true, "verified": 3, "anchored_at": { "sequence": 5, "hash": "db4d…" } }
```

A chain whose oldest events are missing **without** a matching signed
checkpoint fails verification — deleting old rows does not get the retention
excuse for free.

The web UI shows the same status permanently in the header:
`chain intact · 1284 events`, or a loud red `CHAIN BROKEN at #7`.

## Offline: the auditor's laptop

The JSONL export carries everything needed to verify without any access to
the server:

```bash
node backend/scripts/verify-export.js clomp-export.jsonl
```

```
✔ tenant 26af…: 1284 events verified, chain intact
✔ tenant 26af…: checkpoint at sequence 1280 signed 2026-07-14T02:00:00.000Z — signature valid
```

Exit code `0` means intact; `1` means broken or unreadable. The verifier

- recomputes every event hash from canonical JSON,
- checks each `prev_hash` link and sequence continuity,
- validates every checkpoint signature against its embedded public key,
- handles partial exports (a range, or a retention-pruned history) and says
  so explicitly.

## From the CLI

```bash
clomp verify
# chain intact — 1284 events verified, checkpoint #1280 signature valid
# (exit 0; exit 1 on a broken chain — cron/monitoring friendly)
```

## What "broken" tells you

| `reason` | Meaning |
|---|---|
| `hash mismatch` | The event's content does not match its stored hash — the row was altered |
| `prev_hash mismatch` | The link to the predecessor is wrong — an event was replaced or reordered |
| `sequence gap` | An event was deleted from the middle of the chain |
| `history … without a matching signed checkpoint anchor` | Old events are missing and no signed checkpoint attests the cut point |

Verification tells you **where** history broke, not who broke it. That is
what [external anchoring](/operations/anchoring) and your database access
logs are for.
