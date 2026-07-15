# Deployment

## Docker Compose (recommended)

The repository's `docker-compose.yml` runs three containers: PostgreSQL 16,
the backend (Express) and the web UI (nginx). Prebuilt images are pulled
from GHCR; `docker compose up -d --build` builds locally instead.

```bash
cp .env.example .env       # set POSTGRES_PASSWORD
docker compose up -d
docker compose exec backend node scripts/create-admin.js you@example.com "Your Name"
```

Postgres is bound to `127.0.0.1` only — the containers talk over the compose
network, and the host mapping exists solely for local inspection.

## Production checklist

1. **TLS.** Put a reverse proxy (Caddy, nginx, Traefik) in front and set
   `COOKIE_SECURE=true`.
2. **CORS.** Set `ALLOWED_ORIGINS` to your exact origin — never `*`.
3. **External anchoring.** Set `ANCHOR_EMAIL_TO` or `ANCHOR_WEBHOOK_URL` —
   see [External anchoring](/operations/anchoring). This is the single most
   important hardening step.
4. **Backups.** Postgres volume + `KEY_DIR` (checkpoint signing keypair) +
   evidence directory. Test restores — see [Backup & restore](/operations/backup).
5. **Passkeys** (optional). On an HTTPS install with a stable domain, set
   `WEBAUTHN_ORIGIN` — see [Users & authentication](/operations/authentication).
6. **Rate limits.** The defaults (`RATE_LIMIT_*`) are sane; tighten rather
   than loosen.
7. **Overdue reminders & webhooks** (optional). `NOTIFY_EMAIL_TO` mails a
   daily digest when scheduled controls slip; `EVENT_WEBHOOK_URL` forwards
   events to Slack relays or a SIEM — see [Integrations](/operations/integrations).
8. **Defense in depth** (optional). The default setup lets the application's
   database role own the schema. Create a restricted role instead:

   ```bash
   DATABASE_URL=postgresql://clomp:owner-pw@host/clomp \
     node backend/scripts/harden-db-role.js --role clomp_app --password 'strong-pw'
   ```

   The new role runs the app but cannot `UPDATE`/`DELETE` events or disable
   the append-only trigger. Keep the owning role for schema upgrades and
   [retention](/operations/retention); re-run the script after upgrades.

All configuration is environment variables — see the
[configuration reference](/reference/configuration).

## Sizing

Audit volumes are small. Events are single-row inserts with a per-tenant
advisory lock; a modest VM with a few GB of disk carries years of activity
for most organizations. The chain is verified in streaming batches, so
verification memory stays flat regardless of history size.

## Upgrades

```bash
docker compose pull && docker compose up -d
```

The schema is created idempotently at startup (`CREATE TABLE IF NOT
EXISTS`); new tables and triggers appear automatically. The events table is
append-only, so upgrades never rewrite history.
