-- 003: product features landed together after v0.2.0 —
-- multi-tenant first slice, API key lifecycle, webhook delivery log.

-- Multi-tenant first slice: a human-readable label next to the slug-like
-- name, and a soft-deactivation flag (the chain is append-only, so tenants
-- are never hard-deleted).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- API key lifecycle: optional expiry (enforced at auth) and throttled
-- last-use tracking so stale keys are visible to admins.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- Outgoing webhook delivery log: one row per attempted delivery (event
-- webhooks and checkpoint anchoring). Only a payload summary is stored —
-- the full body is rebuilt from the events/checkpoints tables on retry.
-- Pending rows survive restarts; the in-process sweeper picks them up.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK (kind IN ('event', 'anchor')),
  url TEXT NOT NULL,
  payload_summary JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant ON webhook_deliveries(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created ON webhook_deliveries(created_at);
