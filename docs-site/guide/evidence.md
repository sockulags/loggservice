# Evidence files

An audit event often needs an attachment: the access-review spreadsheet, the
restore-test log, the pentest report. In clomp, evidence is as
tamper-evident as the event itself.

## How it works

1. Upload the file (UI, CLI `--evidence`, or `POST /api/evidence`).
2. The server computes the file's **SHA-256** and stores the file
   content-addressed — identical bytes are stored once, regardless of how
   many events reference them.
3. You attach `{ filename, sha256, size }` to the event's `evidence` array.
4. The evidence array is **part of the hashed event payload** — swapping the
   file after the fact breaks the chain, and the hash in the event will not
   match the substituted file.

```bash
# CLI: upload + attach in one step
clomp record pentest.completed --actor user:lucas \
  --target scope:external --evidence ./pentest-2026.pdf
```

```bash
# REST: two steps
curl -X POST https://clomp.example.com/api/evidence \
  -H "X-API-Key: ..." -F "file=@pentest-2026.pdf"
# => { "sha256": "9f2c…", "filename": "pentest-2026.pdf", "size": 482133 }

curl -X POST https://clomp.example.com/api/events \
  -H "X-API-Key: ..." -H "Content-Type: application/json" \
  -d '{"action":"pentest.completed","actor":{"type":"user","id":"lucas"},
       "evidence":[{"filename":"pentest-2026.pdf","sha256":"9f2c…","size":482133}]}'
```

## Retrieval and reporting

- `GET /api/evidence/:sha256` downloads the file (auditors included).
- The PDF report contains an **evidence appendix**: every attachment with
  its SHA-256, so the auditor can independently confirm that the file they
  were handed is the file that was chained.

## Limits and storage

- Default max upload size is 25 MB (`MAX_EVIDENCE_BYTES`).
- Files live outside the database (`EVIDENCE_DIR`, covered by the Docker
  volume). Back the directory up together with the database — see
  [Backup & restore](/operations/backup).
