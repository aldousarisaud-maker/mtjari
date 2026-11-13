# Mtjari.cc — Architecture

Status: Phase 1 implemented (identity, tenancy, RBAC, audit). Sections marked **Planned** describe later phases and are design, not code.

## 1. Goals and constraints

- Multi-tenant e-commerce SaaS for Kuwait and the GCC, Arabic-first (RTL) with English.
- Thousands of stores on shared infrastructure without a rebuild.
- Strict tenant isolation: a bug in application code must not be enough to leak another store's data.
- Deployable on a single VPS with Docker Compose first; able to split into more machines later.
- No card data stored by Mtjari (hosted checkout or tokenization only).

## 2. System overview

```
                         ┌──────────────── Internet ────────────────┐
                         │                                          │
                 mtjari.cc / *.mtjari.cc                   custom domains
                         │                                          │
                    ┌────▼──────────────────────────────────────────▼────┐
                    │        Nginx (TLS, rate limit, real client IP)     │
                    └────┬───────────────────────────────────────────────┘
                         │
        ┌────────────────▼───────────────┐
        │ apps/web  (Next.js, SSR)       │  marketing site, merchant dashboard,
        │ httpOnly cookie session (BFF)  │  later: storefront renderer, super admin
        └────────────────┬───────────────┘
                         │ REST /v1 (internal network)
        ┌────────────────▼───────────────┐      ┌──────────────────────────┐
        │ apps/api  (NestJS)             │◄────►│ Redis + BullMQ (Planned) │
        │ auth, tenancy, RBAC, audit     │      │ queues, cache, locks     │
        └────────────────┬───────────────┘      └────────────┬─────────────┘
                         │                                   │
        ┌────────────────▼───────────────┐      ┌────────────▼─────────────┐
        │ PostgreSQL 16                  │      │ apps/worker (Planned)    │
        │ Row-Level Security per store   │      │ webhooks, email, feeds   │
        └────────────────────────────────┘      └──────────────────────────┘
                                                 S3-compatible storage + CDN (Planned)
```

## 3. Monorepo layout

| Path | Purpose | State |
|---|---|---|
| `packages/shared` | Zod schemas, permission catalogue, slug rules shared by API and web | Done |
| `packages/db` | Prisma schema, SQL migrations (incl. RLS), `withTenant` helper, seed | Done |
| `apps/api` | NestJS REST API | Phase 1 modules done |
| `apps/web` | Next.js app (marketing + dashboard) | Phase 1 screens done |
| `apps/e2e` | Playwright browser tests with a local SMTP sink | Done |
| `apps/worker` | BullMQ workers | Planned (Phase 4) |
| `packages/themes` | Theme engine and the 25 templates | Planned (Phase 3, 6) |
| `packages/payments` | Payment adapter interface and provider modules | Planned (Phase 4, 5) |
| `infra/` | Postgres bootstrap, Dockerfiles, compose, nginx, backup | Done (not yet run on a server) |

Tooling: pnpm workspaces, Turborepo, TypeScript strict everywhere, Jest (+SWC), Playwright.

## 4. Multi-tenancy model

**Decision: shared database, shared schema, `store_id` on every tenant table, enforced by PostgreSQL Row-Level Security.**

Why not schema-per-tenant or database-per-tenant: migrations across thousands of schemas are slow and fragile, connection pooling suffers, and cross-tenant platform reporting (MRR, super admin) becomes hard. Shared schema with RLS scales to many thousands of small tenants; large tenants can later be moved to dedicated databases because all access already goes through one helper.

### How isolation is enforced (three layers)

1. **Database (the one that matters).**
   - The API connects as `mtjari_app`: not a superuser, `NOBYPASSRLS`, owns no tables. Migrations run as a separate `mtjari_owner` role.
   - Every tenant table has `ENABLE ROW LEVEL SECURITY` with policies comparing `store_id` to `app_tenant_id()`, which reads the transaction-local setting `app.tenant_id`.
   - If no tenant is set, the function returns NULL and policies match nothing: **default deny**.
   - `WITH CHECK` clauses stop writing or moving rows into another store.
   - The API **refuses to start** if its database role could bypass RLS (`PrismaService.assertRestrictedRole`).
2. **Data access helper.** `withTenant(prisma, { storeId, userId }, fn)` opens a transaction and sets the context with `set_config(..., true)` (same as `SET LOCAL`). The setting disappears at commit/rollback, so a pooled connection cannot carry one tenant's context into another request.
3. **Application.** `StoreAccessGuard` resolves `:storeId`, checks active membership and required permissions, and returns 404 to non-members so store ids cannot be probed. Services still filter by `storeId` explicitly (defence in depth).

A user's own memberships are readable across stores (policy on `app.user_id`) so "my stores" works without a tenant context. A few `SECURITY DEFINER` functions answer narrow pre-tenant questions (host → store id, slug taken, invitation → store id) and return ids/booleans only.

### Tenant resolution

| Surface | How the tenant is determined |
|---|---|
| Merchant API | `:storeId` in the path + membership check |
| Storefront (Planned) | `Host` header → `resolve_store_by_host()` (subdomain or verified custom domain), cached in Redis |
| Webhooks (Planned) | Opaque per-store endpoint id in the URL + provider signature |
| Workers (Planned) | `storeId` in the job payload; every job runs inside `withTenant` |

### Scaling path

PgBouncer in transaction mode works with this design because context is transaction-local. Next steps when needed: read replicas for storefront reads, Redis page/data cache, partition high-volume tables (`orders`, `audit_logs`, analytics events) by time, move large tenants to dedicated clusters behind the same helper.

## 5. Identity, sessions and RBAC

- **Users are global**, stores are tenants, `memberships` join them with a role. One person can own or work in several stores.
- Passwords: argon2id (19 MiB, t=2). Login errors are identical for unknown email and wrong password; registration never reveals whether an email exists.
- **Access token**: JWT (HS256, 15 min) carrying only `sub` and `sid`. Every request re-checks the session row, so logout, password reset, suspension and role changes take effect immediately.
- **Refresh token**: random 48 bytes, stored as SHA-256, rotated on every use. Re-use of a rotated token revokes the whole session family (theft detection). Concurrent refreshes are resolved atomically.
- **MFA**: TOTP, secret encrypted with AES-256-GCM (key ring with rotation, bound to the user id), 10 single-use recovery codes stored hashed.
- **Web session**: the browser only holds httpOnly, SameSite=Lax cookies. Next.js server actions and server components call the API; page JavaScript never sees a token. The Next.js proxy refreshes expired access tokens with single-flight.
- **RBAC**: permissions are strings (`orders:write`). Each store gets five built-in roles (owner, admin, manager, staff, viewer) and can create custom roles. Rules enforced in the API: nobody can grant a permission they do not hold, only owners can grant owner, the last owner cannot leave or be demoted, system roles are immutable.
- **Platform roles** (`SUPPORT`, `SUPER_ADMIN`) exist on the user for the Phase 9 super admin; no endpoint uses them yet.

## 6. Audit logging

- `audit_logs` is append-only: the runtime role has `INSERT` and `SELECT` only (no `UPDATE`/`DELETE` grant).
- Store-scoped entries are written **in the same transaction** as the change they describe; if the change rolls back, so does the entry.
- Platform entries (auth events, `store_id` NULL) can be written but not read by the runtime role.
- Metadata is passed through a redactor that masks keys resembling credentials.
- Each entry records actor, action, entity, metadata diff, IP, user agent and request id.

## 7. API conventions

- REST under `/v1`, JSON, cursor pagination, machine-readable error codes (`slug_taken`, `missing_permission`) that the web app translates.
- Validation with Zod schemas from `packages/shared` (same schema on both sides).
- Global guards: rate limit (per IP; stricter bucket for auth routes), authentication (opt-out with `@Public()`).
- Structured logs (pino) with request ids; authorization headers, cookies, passwords and tokens are redacted.

## 8. Planned components (later phases)

- **Storefront engine**: Next.js route group resolved by host, SSR/ISR per store, theme packages rendering a shared section schema (see THEME_SYSTEM.md).
- **Payments**: adapter interface per provider, encrypted per-store credentials, signed and idempotent webhooks, reconciliation (see PAYMENT_INTEGRATIONS.md).
- **Workers**: BullMQ queues for webhooks, notifications, feeds, image processing, abandoned carts, billing.
- **Storage**: S3-compatible bucket with per-store prefixes, signed uploads, image variants (WebP/AVIF) behind a CDN.
- **Super admin**: separate route group and API namespace guarded by platform role and mandatory MFA, using a dedicated DB role with explicit cross-tenant policies.
- **Plan limits**: `plans`, `subscriptions` and an entitlement service checked in API guards (never only in the UI).

## 9. Key decisions

| Decision | Reason |
|---|---|
| RLS over application-only filtering | A missed `WHERE` must not become a data leak |
| Separate owner and runtime DB roles | Table owners bypass RLS; the API must never be one |
| Server-checked sessions over stateless JWT | Immediate revocation and permission changes |
| BFF cookies over tokens in the browser | XSS cannot steal a session token |
| One Next.js app for marketing + dashboard (storefront added later) | Shared design system and i18n; can be split per surface when traffic requires |
| Soft delete for stores | Recoverable mistakes and billing/audit history |
