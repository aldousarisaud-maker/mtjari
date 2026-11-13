-- =====================================================================
-- Tenant isolation: Row-Level Security, grants and safe lookups.
--
-- The API connects as mtjari_app (NOBYPASSRLS, not table owner). Every
-- tenant-scoped query runs inside a transaction that first executes
--   set_config('app.tenant_id', <store uuid>, true)
--   set_config('app.user_id',   <user uuid>,  true)
-- When the setting is missing the helpers return NULL and policies match
-- nothing: the default is deny.
-- =====================================================================

CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------
-- Grants for the runtime role
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION app_tenant_id(), app_user_id() TO mtjari_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, sessions, email_tokens, stores, store_domains, roles, memberships, invitations
  TO mtjari_app;

-- Audit log is append-only for the application.
GRANT SELECT, INSERT ON audit_logs TO mtjari_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM mtjari_app;

-- Membership-check helper used by policies. SECURITY DEFINER so the
-- stores/roles policies don't recurse through memberships' own RLS.
CREATE OR REPLACE FUNCTION app_is_member(p_store uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.store_id = p_store AND m.user_id = app_user_id() AND m.status = 'ACTIVE'
    )
  $$;
REVOKE ALL ON FUNCTION app_is_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_member(uuid) TO mtjari_app;

-- ---------------------------------------------------------------------
-- stores: readable in its own tenant context or by an active member
-- (for "my stores" listings); writable only in its own tenant context.
-- ---------------------------------------------------------------------
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY stores_select ON stores FOR SELECT TO mtjari_app
  USING (id = app_tenant_id() OR app_is_member(id));
CREATE POLICY stores_insert ON stores FOR INSERT TO mtjari_app
  WITH CHECK (id = app_tenant_id());
CREATE POLICY stores_update ON stores FOR UPDATE TO mtjari_app
  USING (id = app_tenant_id()) WITH CHECK (id = app_tenant_id());
CREATE POLICY stores_delete ON stores FOR DELETE TO mtjari_app
  USING (id = app_tenant_id());

-- ---------------------------------------------------------------------
-- memberships: tenant rows, plus the current user's own rows (read only).
-- ---------------------------------------------------------------------
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_select ON memberships FOR SELECT TO mtjari_app
  USING (store_id = app_tenant_id() OR user_id = app_user_id());
CREATE POLICY memberships_write ON memberships FOR ALL TO mtjari_app
  USING (store_id = app_tenant_id()) WITH CHECK (store_id = app_tenant_id());

-- ---------------------------------------------------------------------
-- roles: tenant rows, plus roles attached to the user's own memberships.
-- ---------------------------------------------------------------------
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_select ON roles FOR SELECT TO mtjari_app
  USING (store_id = app_tenant_id() OR app_is_member(store_id));
CREATE POLICY roles_write ON roles FOR ALL TO mtjari_app
  USING (store_id = app_tenant_id()) WITH CHECK (store_id = app_tenant_id());

-- ---------------------------------------------------------------------
-- Plain tenant tables.
-- ---------------------------------------------------------------------
ALTER TABLE store_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY store_domains_tenant ON store_domains FOR ALL TO mtjari_app
  USING (store_id = app_tenant_id()) WITH CHECK (store_id = app_tenant_id());

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitations_tenant ON invitations FOR ALL TO mtjari_app
  USING (store_id = app_tenant_id()) WITH CHECK (store_id = app_tenant_id());

-- Audit: store events are visible to that store; platform events
-- (store_id IS NULL) can be written by the app but only read by
-- platform tooling running as a privileged role.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_select ON audit_logs FOR SELECT TO mtjari_app
  USING (store_id = app_tenant_id());
CREATE POLICY audit_insert ON audit_logs FOR INSERT TO mtjari_app
  WITH CHECK (store_id IS NULL OR store_id = app_tenant_id());

-- ---------------------------------------------------------------------
-- Narrow SECURITY DEFINER lookups needed before a tenant is known.
-- They return ids/booleans only, never row data.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_store_by_host(p_host text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT d.store_id FROM store_domains d
    JOIN stores s ON s.id = d.store_id
    WHERE d.hostname = lower(p_host)
      AND d.status IN ('VERIFIED', 'ACTIVE')
      AND s.deleted_at IS NULL AND s.status IN ('DRAFT', 'ACTIVE')
    LIMIT 1
  $$;

CREATE OR REPLACE FUNCTION store_slug_taken(p_slug text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM stores WHERE slug = lower(p_slug)) $$;

CREATE OR REPLACE FUNCTION find_invitation_store(p_token_hash text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT store_id FROM invitations
    WHERE token_hash = p_token_hash AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
    LIMIT 1
  $$;

REVOKE ALL ON FUNCTION resolve_store_by_host(text), store_slug_taken(text), find_invitation_store(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_store_by_host(text), store_slug_taken(text), find_invitation_store(text) TO mtjari_app;

-- Future tables created by the owner get no implicit access; each new
-- migration must GRANT and add policies explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE mtjari_owner IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
