# CLI

The `clomp` command ships with the Node SDK package and has **zero runtime
dependencies** (Node ≥ 18).

```bash
npm install -g @clomp/sdk-node
```

Configuration via environment:

```bash
export CLOMP_API_URL=https://clomp.example.com
export CLOMP_API_KEY=clomp_live_...
```

## Commands

### `clomp record <action> [options]`

Append an event.

```bash
clomp record patch.applied --actor service:ci --target system:web-01
clomp record access.review.completed --actor user:lucas --target scope:all-prod \
  --context '{"reviewed_accounts": 44}' --occurred-at 2026-07-07T09:00:00Z \
  --evidence ./review-q3.pdf
```

| Option | Meaning |
|---|---|
| `--actor type:id` | Defaults to `service:clomp-cli` |
| `--target type:id` | Optional |
| `--context '<json>'` | Free-form metadata |
| `--occurred-at <iso>` | Backfill timestamp (visible by design) |
| `--evidence <file>` | Uploads the file and chains its SHA-256 |

Prints `recorded #<sequence> <action>`, and warns when the action is outside
the catalog.

### `clomp verify`

Recomputes the chain server-side. Exit `0` on intact, **exit `1` on a broken
chain or invalid checkpoint signature** — designed for cron and monitoring.

```
chain intact — 1284 events verified, checkpoint #1280 signature valid
```

### `clomp schedules [--fail-on-overdue]`

Lists scheduled controls with status. With `--fail-on-overdue`, exits `1`
when any control is overdue:

```
ok       Quarterly access review                  quarterly  last 2026-07-07  due 2026-10-07
overdue  Monthly vulnerability remediation        monthly    last never       due 2026-05-05
1 control(s) overdue
```

### `clomp export [--out <file>] [--from <iso>] [--to <iso>]`

Downloads the offline-verifiable JSONL export (stdout by default).

### `clomp catalog`

Prints the seeded action catalog with SOC 2 / NIS2 mappings.

### `clomp verify-file <export.jsonl>` (offline)

Recomputes the hash chain and validates checkpoint signatures in an export —
**no server access, no API key**. This is what the auditor runs:

```bash
npx -y -p @clomp/sdk-node clomp verify-file clomp-export.jsonl
```

Handles partial exports (retention-pruned history) and exits `1` on any
break. The canonical-JSON and hashing rules are byte-identical to the
server's ([specification](/reference/hash-chain)).

### `clomp anchor-check <digest> <export.jsonl>` (offline)

Closes the anchoring loop: takes an archived checkpoint — the anchoring
email text or the webhook JSON — and an export, then

1. validates the archived checkpoint's Ed25519 signature, and
2. confirms the export's history at that sequence matches the anchored hash.

A mismatch means the chain was rewritten *after* the checkpoint was
anchored:

```
✘ HISTORY MISMATCH: export's event #1280 has hash 9f2ca01b…, the archived
  checkpoint says db4d5dab… — the chain was rewritten after this checkpoint
  was anchored
```

## Patterns

```bash
# CI: log every production deploy
clomp record patch.applied --actor service:github-actions --target "system:$SERVICE"

# cron: alert when a control slips
clomp schedules --fail-on-overdue || notify-send "clomp: overdue security control"

# nightly: keep an offsite, provably-intact copy of the chain
clomp export --out "/mnt/offsite/clomp-$(date +%F).jsonl"
```
