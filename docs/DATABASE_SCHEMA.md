# Mtjari.cc — Database Schema

PostgreSQL 16, Prisma ORM. Source of truth: `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations/`.

## Conventions

- Primary keys are UUIDs. Table and column names are `snake_case`; Prisma models are `PascalCase`.
- Every tenant-owned table has `store_id uuid NOT NULL` with an index that starts with `store_id`, and RLS policies. A migration that adds a tenant table must also add its `GRANT`s and policies (default privileges give the runtime role nothing).
- Money (from Phase 2): integer minor units in `bigint` plus an ISO currency code. KWD, BHD and OMR have 3 decimal places; SAR, AED and QAR have 2. Never floats.
- Timestamps are `timestamptz` in UTC. Secrets are stored encrypted (AES-256-GCM envelope) or hashed (SHA-256 for random tokens, argon2id for passwords).
- Bilingual content: `name` + `name_ar`-style column pairs for short fields; JSON `{ar, en}` for long/rich content.

## Roles

| Role | Used by | Rights |
|---|---|---|
| `mtjari_owner` | Migrations only | Owns schema |
| `mtjari_app` | API and workers | `NOSUPERUSER NOBYPASSRLS`; DML on tables it is granted; `audit_logs` is INSERT/SELECT only |
| `mtjari_platform` (Planned, Phase 9) | Super admin API | Explicit cross-tenant read policies |

## Implemented in Phase 1

```
users ──< sessions
  │  └──< email_tokens
  └──< memberships >── stores ──< store_domains
              │           ├──< roles ──< invitations
              └── roles   └──< audit_logs
```

| Table | Scope | Notes |
|---|---|---|
| `users` | Global | `email` unique (lowercased), `password_hash` (argon2id), `email_verified_at`, `mfa_secret_enc`, `mfa_recovery_hashes[]`, `failed_login_count`, `locked_until`, `platform_role` |
| `sessions` | Global (per user) | Rotating refresh tokens: `token_hash` unique, `family_id`, `replaced_by_id`, `revoked_at`, `expires_at`, ip, user agent |
| `email_tokens` | Global (per user) | `VERIFY_EMAIL` / `RESET_PASSWORD`, hashed, single use, expiring |
| `stores` | **Tenant root** | `slug` unique, `business_type`, `country`, `currency`, `default_locale`, `status` (DRAFT/ACTIVE/SUSPENDED/CLOSED), `deleted_at` |
| `store_domains` | Tenant | `hostname` unique, `type` (SUBDOMAIN/CUSTOM), `status`, `ssl_status`, `verification_token`, `is_primary` |
| `roles` | Tenant | `key` for built-in roles, `permissions text[]`, `is_system`; unique `(store_id, name)` and `(store_id, key)` |
| `memberships` | Tenant | unique `(store_id, user_id)`, `role_id`, `status` |
| `invitations` | Tenant | `email`, `role_id`, `token_hash` unique, `expires_at`, `accepted_at`, `revoked_at` |
| `audit_logs` | Tenant or platform | `store_id` nullable, actor, `action`, entity, `metadata jsonb`, ip, user agent, request id; indexes `(store_id, created_at desc)` |

### RLS policies (migration `tenant_isolation`)

| Table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| `stores` | own tenant, or caller is an active member | own tenant only |
| `memberships` | own tenant, or the caller's own rows | own tenant only |
| `roles` | own tenant, or stores the caller belongs to | own tenant only |
| `store_domains`, `invitations` | own tenant | own tenant |
| `audit_logs` | own tenant | INSERT for own tenant or platform (NULL); no UPDATE/DELETE grant |

Helper functions: `app_tenant_id()`, `app_user_id()`, `app_is_member(store)`, and the `SECURITY DEFINER` lookups `resolve_store_by_host(host)`, `store_slug_taken(slug)`, `find_invitation_store(token_hash)`.

## Planned tables by phase

All of these are tenant tables (`store_id` + RLS) unless marked *platform*.

**Phase 2 — Catalogue and inventory (implemented, migration `catalog`)**
`categories` (tree via `parent_id`), `brands`, `products` (type SIMPLE/VARIANT/DIGITAL, status DRAFT/ACTIVE/ARCHIVED, bilingual name and description, SEO fields, tags, `deleted_at`), `product_options` (name + ordered values), `product_variants` (option values as JSON, SKU, barcode, `price`, `compare_at_price`, `cost`, `track_inventory`, `stock_quantity`, `low_stock_threshold`), `product_media` (storage key, widths, alt text, position), `product_categories`, `product_relations` (RELATED/UPSELL/CROSS_SELL), `inventory_movements` (append-only ledger: delta, balance after, reason, actor).
- Money columns are `integer` minor units (1 KWD = 1000, 1 SAR = 100). No floats anywhere.
- Unique `(store_id, sku)` and `(store_id, slug)`; checks: prices ≥ 0, `compare_at_price > price`, `stock_quantity ≥ 0`.
- Every child references its parent with a composite `(store_id, id)` foreign key, because foreign-key checks ignore RLS; this makes cross-store references impossible at the database level.
- `inventory_movements` has INSERT and SELECT grants only. `stock_quantity` is changed only together with a ledger row, under `SELECT ... FOR UPDATE`.
- Not implemented yet (see IMPLEMENTATION_PLAN): `stock_locations` / per-location levels, `attributes`, `import_jobs`.

**Phase 3 — Storefront and themes**
`themes` (*platform* catalogue), `store_themes` (installed theme, settings JSON, draft vs published), `theme_versions`, `pages`, `navigation_menus`, `redirects`.

**Phase 4/5 — Checkout, orders, payments**
`customers`, `customer_addresses` (country-specific JSON validated by schema), `carts`, `cart_items`, `orders` (number per store, status, totals snapshot), `order_items` (price/tax snapshot), `order_events` (timeline), `shipments`, `returns`, `refunds`, `delivery_zones`, `delivery_rates`, `delivery_slots`, `pickup_locations`, `coupons`, `coupon_redemptions`,
`payment_gateway_configs` (provider, mode, encrypted credentials, display name, sort order, enabled), `payments` (provider reference, status, amount, idempotency key unique per store), `payment_events` (raw verified webhook log, unique provider event id), `payment_refunds`, `reconciliation_runs`,
`geo_countries`, `geo_regions`, `geo_areas` (*platform* reference data: Kuwait governorates and areas, other GCC countries; versioned and updatable).

**Phase 7 — SEO and marketing integrations**
`seo_settings`, `seo_audits`, `seo_issues`, `not_found_hits`, `integration_connections` (Google/Meta/TikTok/Snap OAuth tokens encrypted), `tracking_events` (deduplicated by event id), `merchant_feeds`, `feed_diagnostics`.

**Phase 8 — Marketing, CRM, notifications**
`discount_rules`, `gift_cards`, `gift_card_transactions`, `bundles`, `loyalty_accounts`, `loyalty_transactions`, `customer_groups`, `customer_segments`, `abandoned_carts`, `campaigns`, `referrals`, `notification_templates`, `notification_providers` (encrypted credentials), `notification_log`, `product_reviews`.

**Phase 9 — Billing and platform** (*platform* tables)
`plans`, `plan_features`, `addons`, `subscriptions`, `subscription_invoices`, `subscription_coupons`, `usage_counters`, `feature_flags`, `platform_gateways`, `support_tickets`.

**Phase 3 — Storefront (implemented, migration `storefront`)**
`stores.theme_id` (published theme), `stores.launched_at`; `store_themes` (unique `(store_id, theme_id)`, `draft` JSON, `published` JSON); `carts` (`token_hash` unique, `expires_at`); `cart_items` (composite FKs to cart and variant, unique `(cart_id, variant_id)`, quantity check 1..99). All three have RLS and grants for the runtime role.

## Migration rules

1. Migrations are plain SQL generated by Prisma and reviewed; RLS, grants and functions are hand-written in the same migration as the table.
2. Only forward migrations in production; destructive changes use expand → backfill → contract across releases.
3. The tenant-isolation test suite (`packages/db/test/rls.spec.ts`) must be extended for every new tenant table.
