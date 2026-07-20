-- 002_v0_2_0_features: everything v0.2.0 added on top of the v0.1.0 schema
-- (passkeys, WebAuthn challenges, scheduled controls, session metadata).
--
-- Fresh installs already get all of this from 001_initial.sql. This
-- migration exists for databases bootstrapped by v0.1.0-alpha that upgrade
-- directly to a migration-based release: they are baselined at 001 without
-- re-running it, so the objects v0.1.0 lacked must be created here. Every
-- statement is guarded, so it is a no-op on databases that already have
-- them (e.g. installs bootstrapped by v0.2.0-alpha).

CREATE TABLE IF NOT EXISTS passkeys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id UUID PRIMARY KEY,
  user_id UUID,
  challenge TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('registration', 'authentication')),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  action TEXT NOT NULL,
  title TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
  grace_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_days >= 0 AND grace_days <= 365),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, action)
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
