# Threat model

clomp's core claim is **tamper-evidence**: recorded history cannot be
rewritten without detection. It is *not* confidentiality (the database is
not encrypted at rest) and it is *not* completeness (an event that was never
recorded is invisible — [scheduled controls](/guide/scheduled-controls)
exist to surface that).

## Adversaries and defenses

| Adversary | Attack | Defense |
|---|---|---|
| API client (valid key or editor login) | Alter or delete existing events | No update/delete API exists; the database trigger rejects `UPDATE`/`DELETE` on `events` for every role |
| Insider with the application's database credentials | Rewrite rows directly | Append-only trigger; if they own the table and disable the trigger, the hash chain breaks and `GET /api/verify` pinpoints the first altered sequence |
| Insider who rewrites rows **and** recomputes hashes | Re-hash the chain from the altered event forward | Ed25519-signed checkpoints: the re-hashed chain no longer matches the signed `(sequence, hash)` tips |
| Operator with root on the host (has the signing key) | Rewrite history and re-sign new checkpoints | **External anchoring**: checkpoints archived outside the server will not match the rewritten chain. Without anchoring, a root-level operator can rewrite history that predates the last export an auditor holds — configure anchoring |
| Anyone | Backdate activity invisibly | `occurred_at` and `recorded_at` are separate, both hashed; backfill is visible by design |
| Anyone | Swap an evidence file after the fact | Evidence is content-addressed; its SHA-256 is inside the hashed event |
| Retention operator | Use pruning as cover for erasing inconvenient history | Pruning cuts only at a signed checkpoint, archives first, and appends a `retention.pruned` event with the archive's SHA-256. Missing history without a checkpoint anchor fails verification |

## Trust boundaries

- **The application's Postgres role owns the schema** in the default
  docker-compose setup, so anyone holding `DATABASE_URL` credentials can
  disable the append-only trigger. They still cannot evade the hash chain
  or signed checkpoints. For defense in depth, run the app as a non-owner
  role with only `INSERT`/`SELECT` on `events`.
- **Checkpoint signing keys live on the server's disk** (`KEY_DIR`). Full
  host compromise means forged checkpoints *from that moment on* — but not
  rewritten history that predates the last externally anchored checkpoint
  or export. Anchoring is the mitigation that matters.
- **Exports contain everything.** Treat export files and the auditor
  channel with the same care as the database.

## Continuous proof

The claim is tested, not asserted: on every push, CI runs an end-to-end
tamper test against a real PostgreSQL — it corrupts a row (via table-owner
trigger bypass) and asserts that `verify` pinpoints the break and the
offline verifier rejects the export
([`backend/scripts/e2e.js`](https://github.com/sockulags/clomp/blob/main/backend/scripts/e2e.js)).

## Reporting vulnerabilities

Use GitHub's private vulnerability reporting on the repository — see
[SECURITY.md](https://github.com/sockulags/clomp/blob/main/SECURITY.md).
