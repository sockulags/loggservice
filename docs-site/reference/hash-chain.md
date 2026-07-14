# Hash chain specification

This page specifies the chain precisely enough to write an independent
verifier. The reference implementation is
[`backend/src/hashchain.js`](https://github.com/sockulags/clomp/blob/main/backend/src/hashchain.js)
and it is tested against fixed reference vectors.

## Canonical JSON

The hash input must be byte-identical everywhere, so events are serialized
canonically:

- Object keys sorted lexicographically, recursively.
- No whitespace.
- UTF-8 encoding.
- `null` is preserved; absent optional fields are serialized as `null`.

## The hashed payload

Exactly these fields, in canonical form:

```json
{
  "action": "...",
  "actor": { ... },
  "context": { ... } | null,
  "evidence": [ ... ] | null,
  "occurred_at": "2026-07-07T09:00:00.000Z",
  "recorded_at": "2026-07-07T09:00:01.234Z",
  "sequence": 1285,
  "target": { ... } | null,
  "tenant_id": "26af2c69-..."
}
```

Timestamps are ISO 8601 with millisecond precision, UTC (`.toISOString()`
semantics). The row `id` (UUID) is *not* hashed — storage identity can
change without breaking the chain; audit content cannot.

## The chain

```
hash = SHA-256( prev_hash_bytes ‖ utf8(canonical_payload) )
```

- `prev_hash` is the 32-byte (64 hex chars) hash of the previous event in
  the same tenant's chain.
- **Genesis:** the first event has `prev_hash = 0x00…00` (32 zero bytes).
- `sequence` is per-tenant, monotonic and gap-free. Inserts run in a
  transaction holding a per-tenant advisory lock, so the chain never forks
  under concurrent writes.

## Checkpoints

A checkpoint attests the chain tip at a point in time:

```
payload   = canonical JSON of { hash, sequence, signed_at, tenant_id }
signature = Ed25519( payload )
```

Stored (and exported) with the signing public key in SPKI/PEM form. The
keypair is generated on first use and lives in `KEY_DIR`.

## Verification algorithm

For each tenant, over events sorted by sequence:

1. Expect the first event's `prev_hash` to be genesis — **or**, if the chain
   starts above sequence 1 (retention pruning), expect a signed checkpoint
   at `first.sequence − 1` whose `hash` equals `first.prev_hash`.
2. For each event: check `sequence` continuity, check `prev_hash` equals the
   previous event's `hash`, recompute the hash and compare.
3. For each checkpoint: verify the Ed25519 signature over the canonical
   payload, and — when the referenced sequence is in range — that its `hash`
   matches that event's hash.

First failure wins and is reported with its sequence number. The reference
offline implementation is
[`backend/scripts/verify-export.js`](https://github.com/sockulags/clomp/blob/main/backend/scripts/verify-export.js) —
~100 lines, no dependencies beyond Node's `crypto`.

## Export line format

JSONL, one object per line:

```json
{"type":"event","id":"…","tenant_id":"…","sequence":1,"occurred_at":"…","recorded_at":"…","actor":{…},"action":"…","target":null,"context":null,"evidence":null,"prev_hash":"000…0","hash":"ab12…"}
{"type":"checkpoint","tenant_id":"…","sequence":1280,"hash":"db4d…","signature":"<base64>","public_key":"-----BEGIN PUBLIC KEY-----…","signed_at":"…"}
```
