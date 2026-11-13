# Mtjari.cc — Implementation Plan

Rule: a phase is finished only when its automated tests pass. The next phase does not start before that. Each phase ends with a commit series and an update to this file.

## Current status

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture, database, authentication, multi-tenancy, RBAC, audit logs | **Done and tested** (2026-11-13) |
| 2 | Merchant dashboard, products, categories, inventory | **Done and tested** (2026-11-13), see the list of what was left out below |
| 3 | Storefront engine, theme architecture, first 5 templates | Not started |
| 4 | Checkout, orders, payment gateway framework | Not started |
| 5 | Payment providers, webhooks, refunds | Not started |
| 6 | Remaining 20 templates, visual builder | Not started |
| 7 | SEO engine, GA4, Google Ads, Merchant Center | Not started |
| 8 | Marketing, CRM, delivery, notifications | Not started |
| 9 | Subscriptions, super admin, billing | Not started |
| 10 | Testing hardening, performance, security, VPS deployment | Not started |

## Phase 1 — what exists

(Test counts in this section are from the end of Phase 1; current totals are in the Phase 2 table.)

- Monorepo (pnpm, Turborepo), shared validation package, Prisma schema with RLS migrations.
- API: register, verify email, login, refresh rotation, logout, logout-all, forgot/reset password, TOTP MFA, `/me`; stores (create, read, update, close, slug availability); members, invitations, custom roles; audit log listing; health check.
- Web: bilingual landing page, sign-up, email confirmation, login (with MFA), password reset, store creation with live address check, store settings, team, roles, audit log, account security.
- Tests (all run against real PostgreSQL, real SMTP in browser tests):

| Suite | Count | What it proves |
|---|---|---|
| `packages/shared` | 20 | Slug rules, schema normalisation, partial-update behaviour |
| `packages/db` | 16 | RLS: default deny, cross-tenant read/write/move blocked, no context leakage, append-only audit |
| `apps/api` unit | 13 | Encryption, redaction, permission and anti-escalation rules |
| `apps/api` HTTP | 53 | Auth flows, token theft detection, rate limits, cross-tenant attacks, RBAC, audit trail |
| `apps/e2e` (Playwright) | 17 | Full journey in a browser, RTL/LTR, httpOnly cookies, token refresh, staff restrictions, responsive layout |

Not done in Phase 1 (deliberately): wizard steps that depend on later phases (template choice, products, payments, delivery, launch), custom-domain verification and SSL issuance (table and statuses exist; the flow lands with the storefront in Phase 3), Redis/BullMQ (added when the first queue is needed in Phase 4), deployment to a real server.

## Phase 2 — what exists

- Tables: `categories` (tree, max depth 4), `brands`, `products` (SIMPLE / VARIANT / DIGITAL; draft, published, archived; bilingual; SEO fields; soft delete), `product_options`, `product_variants`, `product_media`, `product_categories`, `product_relations`, `inventory_movements`. All with RLS, grants and composite `(store_id, id)` foreign keys so a row can never point at another store's row.
- Money is stored as integers in minor units (fils/halalas); KWD, BHD and OMR use 3 decimals, SAR, AED and QAR use 2. Margin is computed from price and cost.
- API (`/v1/stores/:storeId/...`): categories, brands, products (list with search, status/category/brand filters and paging; create; read; update; delete), `PUT products/:id/variants` (replaces options and variants, keeps stock of variants that stay), `PUT products/:id/relations`, product images (upload, alt text, order, delete), `inventory` (list, low-stock filter), `inventory/adjust`, `inventory/movements`, `catalog/summary`, `products/export` and `products/import` (CSV).
- Inventory: every change goes through an append-only ledger and is applied under a row lock, so concurrent changes are never lost and stock cannot go below zero. Low-stock threshold per variant.
- Images: validated and re-encoded with sharp to WebP at 400/800/1600 px (never upscaled, metadata stripped), max 8 MB and 12 per product. Storage sits behind a driver: local disk (tested) or S3-compatible bucket (written, **not tested** — no bucket yet).
- CSV: export of the whole catalogue; import of up to 1000 rows that creates products (rows with the same slug become variants) or updates price/stock of existing SKUs, with a per-row error report. Cells are protected against spreadsheet formula injection.
- Dashboard: sidebar limited to what the member may open; overview cards (products, published, low stock, out of stock); product list (search, status filter, paging, thumbnail, price range, stock); product editor (bilingual details, categories, brand, tags, SEO, variant generator with live margin, images); categories tree; brands; inventory screen with adjustments and recent movements; CSV import/export. Arabic RTL and English LTR, desktop and mobile.
- Permissions: new `inventory:read` / `inventory:write`; built-in roles follow the code template, so existing stores received them without a data migration.
- A rejected form now keeps what the merchant typed (applies to every form in the app).

Tests after Phase 2 (all against real PostgreSQL; browser tests use real SMTP delivery to a local sink and real image files):

| Suite | Count | New in Phase 2 |
|---|---|---|
| `packages/shared` | 33 | Money conversion per currency, variant matrix, CSV parser and injection guard, slugs |
| `packages/db` | 24 | RLS on every catalogue table, cross-store foreign keys refused, append-only ledger, a guard that fails if any future table with `store_id` lacks RLS |
| `apps/api` | 103 | Product/variant/category/brand CRUD, permissions per role, cross-tenant attacks, concurrent stock changes, image validation, CSV import/export |
| `apps/e2e` (Playwright) | 27 | Create a product with variants and an image → list → stock adjustment → CSV → viewer restrictions → other merchant blocked → delete; layout of every dashboard page on desktop and mobile in both languages |

**Planned for Phase 2 but not built** (moved, nothing is faked in the UI):
- Excel (.xlsx) import/export — CSV only for now. CSV import runs inside the request (max 1000 rows); a background worker with Redis/BullMQ comes with Phase 4.
- Multiple stock locations and stock reservations — one stock figure per variant today; reservations land with checkout (Phase 4).
- Custom product attributes, bulk actions in the product list, drag-and-drop ordering of images and categories.
- Related / upsell / cross-sell products: API and tests exist, there is no screen for it yet.
- Editing a category or brand after creation: API exists, the screens only add and delete.
- Direct browser-to-bucket signed uploads and AVIF output (uploads go through the API, output is WebP).
- Product reviews and "trending" flags from the master prompt belong to the storefront (Phase 3).

**Still needed from you:** an S3-compatible bucket (Cloudflare R2, AWS S3, DigitalOcean Spaces or Backblaze B2) with endpoint, region, bucket name and an access key, before a staging server holds real images. Until then images are stored on the server disk.

## Phase 3 — Storefront engine, theme architecture, first 5 templates
Host-based tenant resolution with caching, storefront routes (home, collection, product, cart, account, pages), theme contract and settings schema, draft/publish, theme switching without data loss, first five themes (Modern Electronics, Luxury Fashion, Perfume Boutique, Coffee House, Gulf Premium), custom-domain verification and automatic SSL, sitemap/robots/canonical basics. See THEME_SYSTEM.md.

## Phase 4 — Checkout, orders, payment framework
Cart, guest checkout, country-specific address forms (Kuwait governorates/areas data), delivery zones/fees/slots/pickup, coupons, order state machine and timeline, PDF invoices, payment adapter interface, encrypted credential storage, webhook pipeline with idempotency, Cash on Delivery as the first adapter.

## Phase 5 — Payment providers
One adapter at a time behind the Phase 4 interface, each with sandbox tests and recorded webhook fixtures. Order to be agreed (suggested: Tap, MyFatoorah, Hesabe, Tabby, Tamara, Deema, Taly). See PAYMENT_INTEGRATIONS.md for what each one requires from you.

## Phase 6 — Remaining 20 templates and visual builder
Section-based editor with drag and drop, device previews, colour and typography editors, header/footer builders, undo/redo, version history, sanitised custom CSS.

## Phase 7 — SEO and Google integrations
SEO manager, structured data, redirects, 404 monitoring, hreflang, audit tool and internal score, GA4/GTM, Google Ads conversions with deduplication and consent, Merchant Center feed. See SEO_STRATEGY.md.

## Phase 8 — Marketing, CRM, delivery, notifications
Discount engine, gift cards, bundles, loyalty, referrals, abandoned carts, segments, email/SMS/WhatsApp behind provider adapters, reviews, returns.

## Phase 9 — Subscriptions, super admin, billing
Plans and limits editable without code, entitlement checks in the API, trials, upgrades/downgrades, grace period, dunning, invoices, add-ons, super admin dashboard (MRR/ARR, merchants, feature flags, platform audit).

## Phase 10 — Hardening and launch
Load tests, accessibility audit, Core Web Vitals budgets, security review and external pen test, monitoring and alerting, backup restore drill, production deployment runbook.

## External requirements summary

| Needed for | What | When |
|---|---|---|
| Source control | GitHub repository | Now |
| Email delivery | SMTP credentials (or Resend/SES) and DNS access for SPF/DKIM on mtjari.cc | Before any real user signs up |
| Deployment | VPS (min. 4 vCPU / 8 GB), DNS control of mtjari.cc incl. wildcard `*.mtjari.cc` | Phase 3 for staging |
| Media | S3-compatible bucket + CDN | Phase 2 staging |
| Payments | Merchant/sandbox accounts per provider | Phase 5 |
| Google | Google Cloud project with OAuth consent screen, Ads developer token, Merchant API access | Phase 7 |
| Messaging | SMS and WhatsApp Business provider accounts | Phase 8 |
