# Retention

Storage limits (GDPR, legal-hold expiry, internal policy) eventually require
deleting old events — from a table whose whole point is that nothing can be
deleted. clomp resolves the tension by making pruning a **deliberate,
privileged operation that preserves chain verifiability**.

There is no retention API. Pruning is a script, run by an operator, with a
role that owns the events table:

```bash
# preview
DATABASE_URL=postgresql://... node backend/scripts/retention-prune.js \
  --keep-days 730 --archive-dir ./archives --dry-run

# execute
DATABASE_URL=postgresql://... node backend/scripts/retention-prune.js \
  --keep-days 730 --archive-dir ./archives --yes
```

## The rules the script enforces

1. **Cuts only at a signed checkpoint.** The prune point `P` is the highest
   checkpointed sequence whose events are older than the cutoff. After the
   prune, the first retained event still carries `prev_hash = hash(P)`, and
   the Ed25519-signed checkpoint attests `(P, hash(P))`. Verification
   anchors there instead of at genesis and reports `anchored_at`. If old
   events exist but no checkpoint does, nothing is pruned.
2. **The tip is never pruned.** At least the newest event always remains.
3. **Archive first.** The pruned range is written to a JSONL file — same
   format as the export, verifiable offline with
   `backend/scripts/verify-export.js` — before anything is deleted. An
   existing archive file is never overwritten.
4. **The prune is itself history.** A `retention.pruned` event is appended
   to the chain *before* the delete, recording the pruned range, cutoff,
   anchor checkpoint and the archive file's SHA-256. An auditor sees that
   pruning happened, when, and can demand the archive whose hash must match.
5. **The append-only trigger is disabled only inside the delete
   transaction**, which requires table ownership.

After each prune the script re-verifies the chain and refuses to report
success otherwise.

## What an attacker cannot do

Deleting old rows and calling it "retention" does not work: a chain whose
oldest events are missing **without** a matching signed checkpoint anchor
fails verification with an explicit reason. The retention path is the only
path that leaves a verifiable chain behind — and it leaves a signed
confession (`retention.pruned`) on the ledger.
