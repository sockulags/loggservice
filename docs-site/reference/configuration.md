# Configuration

All configuration is environment variables. With Docker Compose, set them in
`.env` (see `.env.example` in the repository).

## Required

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | Database password (compose builds `DATABASE_URL` from it) |
| `DATABASE_URL` | Set directly when running the backend outside compose: `postgresql://clomp:…@host:5432/clomp` |

## Ports & networking

| Variable | Default | Description |
|---|---|---|
| `BACKEND_PORT` | `3001` | Host port for the API (container listens on 3000) |
| `WEBUI_PORT` | `8080` | Host port for the web UI |
| `POSTGRES_PORT` | `5432` | Host port for Postgres (bound to `127.0.0.1` only) |
| `ALLOWED_ORIGINS` | localhost dev origins | Comma-separated CORS allowlist — never `*` in production |

## Auth & sessions

| Variable | Default | Description |
|---|---|---|
| `SESSION_TTL_HOURS` | `12` | Web session lifetime |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `WEBAUTHN_ORIGIN` | *(unset)* | Enables passkeys, e.g. `https://clomp.example.com` |
| `WEBAUTHN_RP_ID` | origin's hostname | WebAuthn relying-party ID |

## Checkpoints & anchoring

| Variable | Default | Description |
|---|---|---|
| `CHECKPOINT_SCHEDULE` | `0 2 * * *` | Cron (UTC) for signing the chain tip |
| `KEY_DIR` | `<backend>/data/keys` | Ed25519 checkpoint keypair location |
| `ANCHOR_WEBHOOK_URL` | *(unset)* | POST each checkpoint as JSON |
| `ANCHOR_WEBHOOK_TOKEN` | *(unset)* | Optional `Authorization: Bearer` value |
| `ANCHOR_EMAIL_TO` | *(unset)* | Mail each checkpoint digest |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | — | SMTP settings for email anchoring |

## Evidence

| Variable | Default | Description |
|---|---|---|
| `EVIDENCE_DIR` | `<backend>/data/evidence` | Content-addressed file storage |
| `MAX_EVIDENCE_BYTES` | `26214400` (25 MB) | Max upload size |

## Rate limiting & logging

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window for all limiters |
| `RATE_LIMIT_MAX` | `300` | General requests per window per IP |
| `RATE_LIMIT_EVENTS_MAX` | `1000` | Event-ingestion requests per window |
| `RATE_LIMIT_LOGIN_MAX` | `10` | Login attempts per window |
| `RATE_LIMIT_HEALTH_MAX` | `60` | Health checks per window |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` / `fatal` |
| `TENANT_NAME` | `default` | Name of the installation's tenant (multi-tenant schema, single-tenant operation) |
