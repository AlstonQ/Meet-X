CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE data_region AS ENUM ('eu-central-1', 'eu-west-1', 'us-east-1', 'ap-south-1');
CREATE TYPE membership_role AS ENUM ('owner', 'admin', 'manager', 'member', 'guest');
CREATE TYPE meeting_status AS ENUM (
  'scheduled',
  'dispatching',
  'joining',
  'waiting_room',
  'recording',
  'leaving',
  'processing',
  'ready',
  'failed',
  'cancelled'
);
CREATE TYPE consent_policy AS ENUM ('implicit', 'announce', 'explicit_opt_in');

CREATE TABLE organizations (
  id text PRIMARY KEY CHECK (id ~ '^org_[0-9A-HJKMNP-TV-Z]{26}$'),
  name text NOT NULL,
  slug text NOT NULL,
  data_region data_region NOT NULL DEFAULT 'eu-central-1',
  consent_policy consent_policy NOT NULL DEFAULT 'announce',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX organizations_slug_idx ON organizations (slug);

CREATE TABLE users (
  id text PRIMARY KEY CHECK (id ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
  email text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX users_email_idx ON users (email);

CREATE TABLE memberships (
  id text PRIMARY KEY CHECK (id ~ '^mbr_[0-9A-HJKMNP-TV-Z]{26}$'),
  organization_id text NOT NULL REFERENCES organizations (id),
  user_id text NOT NULL REFERENCES users (id),
  role membership_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX memberships_organization_user_idx ON memberships (organization_id, user_id);

CREATE TABLE meetings (
  id text PRIMARY KEY CHECK (id ~ '^mtg_[0-9A-HJKMNP-TV-Z]{26}$'),
  organization_id text NOT NULL REFERENCES organizations (id),
  title text NOT NULL,
  status meeting_status NOT NULL DEFAULT 'scheduled',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  conference_url_hash text,
  created_by_user_id text REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizations_tenant_isolation ON organizations
  USING (id = current_setting('app.organization_id', true))
  WITH CHECK (id = current_setting('app.organization_id', true));

CREATE POLICY memberships_tenant_isolation ON memberships
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

CREATE POLICY meetings_tenant_isolation ON meetings
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

CREATE INDEX meetings_organization_starts_at_idx ON meetings (organization_id, starts_at);
CREATE INDEX meetings_organization_status_idx ON meetings (organization_id, status);
