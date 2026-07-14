# Backup & restore

Three things must be backed up together:

| What | Where (compose default) | Why |
|---|---|---|
| PostgreSQL data | `postgres-data` volume | The chain, users, schedules, checkpoints |
| Checkpoint signing keypair | `backend-data` volume, `KEY_DIR` (`/app/data/keys`) | Losing it doesn't break old signatures (each checkpoint embeds its public key) but new checkpoints would use a new key — an unexplained key change is exactly what an auditor asks about |
| Evidence files | `backend-data` volume, `EVIDENCE_DIR` (`/app/data/evidence`) | Content-addressed attachments; the chain holds their hashes, not their bytes |

## A simple nightly backup

```bash
# database
docker compose exec postgres pg_dump -U clomp clomp | gzip > backup/clomp-$(date +%F).sql.gz

# keys + evidence (the backend-data volume)
docker run --rm --volumes-from clomp-backend -v "$PWD/backup:/backup" alpine \
  tar czf /backup/clomp-data-$(date +%F).tar.gz /app/data
```

The JSONL export is **not** a substitute for database backups (it lacks
users, API keys and schedules) — but it *is* a fine belt-and-suspenders
artifact: it is offline-verifiable, and archiving one periodically means you
always hold a provably-intact copy of the chain itself.

```bash
clomp export --out offsite/clomp-$(date +%F).jsonl
```

## Restore

1. Restore the SQL dump into a fresh PostgreSQL.
2. Restore `/app/data` (keys + evidence).
3. Start the backend and verify:

```bash
curl -H "X-API-Key: ..." https://clomp.example.com/api/verify
# expect: {"intact":true, …}
```

A successful restore proves itself: if the chain verifies and the latest
checkpoint signature is valid, you restored the same history you backed up.

## Test it — and log it

Restore testing is a scheduled control in the seeded catalog for a reason:

```bash
clomp record backup.tested --actor user:ops --target system:primary-db \
  --context '{"restore_time_minutes": 22, "result": "pass"}'
```

Declare it monthly in **Schedules** and the PDF report will show whether you
actually did it.
