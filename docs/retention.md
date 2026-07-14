# Retention pruning

clomp's events table is append-only at the database level — a trigger rejects
`UPDATE`/`DELETE` for every role. Retention (legal hold expiry, GDPR storage
limits) is therefore a deliberate, privileged operation, never an API:

```bash
DATABASE_URL=postgresql://... node backend/scripts/retention-prune.js \
  --keep-days 730 --archive-dir ./archives --dry-run   # preview
DATABASE_URL=postgresql://... node backend/scripts/retention-prune.js \
  --keep-days 730 --archive-dir ./archives --yes       # execute
```

## Why pruning does not break verifiability

The rules the script enforces, per tenant:

1. **Cuts only at a signed checkpoint.** The prune point `P` is the highest
   checkpointed sequence whose events are older than the cutoff. After the
   prune, the first retained event (`P+1`) still carries `prev_hash =
   hash(P)`, and the Ed25519-signed checkpoint attests `(P, hash(P))`.
   `GET /api/verify` anchors there instead of at genesis and reports
   `anchored_at`. If old events exist but no checkpoint does, nothing is
   pruned.
2. **The tip is never pruned.** At least the newest event always remains.
3. **Archive first.** The pruned range is written to a JSONL file (same
   format as the export) before anything is deleted; the file is
   offline-verifiable with `backend/scripts/verify-export.js`.
4. **The prune is itself history.** A `retention.pruned` event is appended
   to the chain *before* the delete, recording the pruned range, the cutoff,
   the anchor checkpoint and the archive file's SHA-256. An auditor sees that
   pruning happened, when, and can demand the archive whose hash must match.
5. **The trigger is disabled only inside the delete transaction**, which
   requires a role that owns the `events` table.

## What verification looks like afterwards

- `GET /api/verify` → `{ intact: true, verified: N, anchored_at: { sequence: P, hash: … } }`
- A chain whose oldest events are missing **without** a matching signed
  checkpoint fails verification with
  `history before this sequence was removed without a matching signed checkpoint anchor` —
  an attacker deleting old rows does not get the retention excuse for free.
- Offline: `verify-export.js` already verifies partial exports and prints
  `(partial export starting at sequence …)`.
