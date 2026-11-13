# Mtjari.cc — Implementation Plan

Rule: a phase is finished only when its automated tests pass. The next phase does not start before that. Each phase ends with a commit series and an update to this file.

## Current status

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture, database, authentication, multi-tenancy, RBAC, audit logs | **Done and tested** (2026-11-13) |
| 2 | Merchant dashboard, products, categories, inventory | Not started |
| 3 | Storefront engine, theme architecture, first 5 templates | Not started |
| 4 | Checkout, orders, payment gateway framework | Not started |
| 5 | Payment providers, webhooks, refunds | Not started |
| 6 | Remaining 20 templates, visual builder | Not started |
| 7 | SEO engine, GA4, Google Ads, Merchant Center | Not started |
| 8 | Marketing, CRM, delivery, notifications | Not started |
| 9 | Subscriptions, super admin, billing | Not started |
| 10 | Testing hardening, performance, security, VPS deployment | Not started |

## Phase 1 — what exists

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

## Phase 2 — Merchant dashboard, products, categories, inventory

Backend
1. Tables: categories, brands, products, options, variants, media, attributes, relations, stock locations, inventory levels and movements (+ RLS and grants, + isolation tests).
2. Money helper (minor units, 3-decimal currencies), slug generation for Arabic and English.
3. Product CRUD for simple, variant and digital products; variant matrix generation; SKU/barcode uniqueness per store.
4. Inventory ledger: adjustments, reservations API (used by checkout later), low-stock threshold and alert query.
5. Media: S3-compatible storage (MinIO in development), signed uploads, image validation and WebP/AVIF variants.
6. CSV/Excel import and export with row-level error reports (background job; this introduces Redis + BullMQ and `apps/worker`).
7. Dashboard summary endpoints that already have data (product counts, low stock).

Frontend
8. Dashboard shell with the full sidebar, showing only sections that exist.
9. Product list (search, filters, bulk actions), product editor (bilingual fields, variants, media, pricing with margin, SEO fields), categories tree, brands, inventory screen.

Tests: unit (money, variant generation, CSV parsing), API (CRUD, permissions per role, isolation), Playwright (create product with variants and images → appears in list → stock adjustment).

**Needed from you before Phase 2:** an S3-compatible bucket for real uploads (any of: Cloudflare R2, AWS S3, DigitalOcean Spaces, Backblaze B2) with access key and region/endpoint. Development and tests use local MinIO, so this only blocks staging.

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
