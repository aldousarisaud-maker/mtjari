# Mtjari.cc — Implementation Plan

Rule: a phase is finished only when its automated tests pass. The next phase does not start before that. Each phase ends with a commit series and an update to this file.

## Current status

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture, database, authentication, multi-tenancy, RBAC, audit logs | **Done and tested** (2026-11-13) |
| 2 | Merchant dashboard, products, categories, inventory | **Done and tested** (2026-11-13), see the list of what was left out below |
| 3 | Storefront engine, theme architecture, first 5 templates | **Done and tested** (2026-11-13), see the list of what was left out below |
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

Not done in Phase 1 (deliberately): wizard steps that depend on later phases (template choice, products, payments, delivery, launch), custom-domain verification and SSL issuance (table and statuses exist; the flow lands with the storefront in Phase 3), Redis/BullMQ (added when the first queue is needed; now Phase 5), deployment to a real server.

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

## Phase 3 — what exists

- **Shop by hostname.** `{slug}.ROOT_DOMAIN` (and any `store_domains` row with status VERIFIED/ACTIVE) is served as that store's shop. The web tier rewrites shop hosts to internal routes; the dashboard and login do not exist on shop hosts and internal routes cannot be opened directly. The API resolves the store from the host and runs every query inside that store's RLS context.
- **Launch gate.** A shop is public only when the merchant has published a theme and pressed "launch", which requires at least one active product. Before that the address returns 404. Launch and unlaunch are audited.
- **Public storefront API** (`/v1/storefront/*`): store info and navigation, product list (category incl. sub-categories, search, sort by newest/price, pagination), product detail (never exposes cost price or exact stock), sitemap data, anonymous cart.
- **Cart.** Random token in an httpOnly cookie (only its hash is stored), prices and stock always read from the catalogue, quantity limits, lines flagged when a product becomes unavailable. There is no checkout button yet; the cart says ordering opens soon (Phase 4).
- **Theme architecture.** Five themes with separate markup, fonts and layout: Modern Electronics, Luxury Fashion, Perfume Boutique, Coffee House, Gulf Premium. Settings per theme (two colours, announcement bar, hero texts, featured category, number of home products) validated by one schema; draft and published copies per (store, theme), so switching theme and switching back loses nothing and never touches products.
- **Dashboard → "Store and theme"**: status card with the shop address, theme gallery, settings form, private preview (signed 30-minute token kept in an httpOnly cookie, pages marked noindex), publish, launch.
- **SEO basics** per shop: canonical URLs, `hreflang` ar/en/x-default, Product + Breadcrumb + WebSite structured data, `sitemap.xml`, `robots.txt`; search, cart and preview pages are noindex.
- Arabic RTL and English LTR for every page of every theme; content falls back to the other language when a translation is missing.

Tests after Phase 3:

| Suite | Count | New in Phase 3 |
|---|---|---|
| `packages/shared` | 39 | Theme settings validation and defaults |
| `packages/db` | 31 | RLS and cross-store foreign keys for theme and cart tables, quantity limits |
| `apps/api` | 129 | Host resolution, launch gate, preview tokens, product visibility, search escaping, cart rules, cross-shop cart tokens refused, theme permissions |
| `apps/e2e` (Playwright) | 48 | Full merchant journey (preview → customise → publish → launch), shopper journey (browse, search, sort, variants, cart), English storefront, SEO output, shop/platform separation, every page of all five themes on desktop and mobile in both languages |

**Planned for Phase 3 but not built** (nothing is faked in the UI):
- Customer accounts and merchant-written content pages (about, policies). Accounts move to Phase 4 with checkout; pages to Phase 6 with the builder.
- Custom-domain flow (add domain, DNS verification, automatic SSL). The storefront already serves verified domains, but there is no screen or verification job; it needs a real server to build and test. Shops use `{slug}.mtjari.cc` until then.
- Caching/ISR: storefront pages are rendered per request. Caching comes with Redis in Phase 4.
- Section-level layout editing, logo upload, theme version history (Phase 6). Product reviews (Phase 8).
- Cleanup job for expired carts (with the background worker in Phase 4).
- Old-slug 301 redirects and merchant-editable robots rules (Phase 7).

## Phase 4 — what exists
Status: **done and tested**.

- **Delivery and pickup.** Delivery zones per store (Arabic/English name, fee, optional free-delivery threshold, on/off), one-click creation of the six Kuwait governorates, pickup with instructions in both languages, minimum order amount.
- **Guest checkout** on every theme: name, phone (validated and normalised per country, Kuwait first), optional email, Kuwait address form (area, block, street, avenue, house, floor, flat, notes), delivery or pickup, payment method, order note. The checkout button appears only when the store has a usable payment method and a way to receive the order; otherwise the cart says so.
- **Totals are computed on the server** from the catalogue and the zone; the request cannot carry prices, totals or a store id. Stock is taken inside the same transaction as the order (variants locked in a fixed order), the order number is per store (from 1001), and a repeated submit with the same key returns the same order instead of creating a second one.
- **Private order page** (`/orders/{token}`): 43-character random token, only its hash stored, noindex, excluded in robots.txt, no referrer.
- **Emails**: order confirmation to the shopper (when an email was given) and a new-order notice to the store owners.
- **Dashboard → Orders**: list with status tabs and search (number, name, phone), order page with items, totals, customer and address, timeline, internal notes, and only the actions the state machine allows: `PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED`, cancel before delivery. Cancelling returns the stock. Every change is an append-only order event plus an audit-log row.
- **Dashboard → Delivery and payment**: readiness card, payment methods, zones, order options. Permissions: `orders.read`, `orders.write`, `settings.manage`, `payments.manage`.
- **Payment framework**: `PaymentAdapter` interface (offline/online), registry, per-store credentials encrypted with AES-256-GCM and bound to store and provider (write-only: never returned by the API), public webhook endpoint `POST /v1/webhooks/payments/:provider/:storeId` that verifies the signature on the raw body, records each provider event once, checks amount and currency against our payment record and only then marks the order paid. A database trigger refuses to mark an order paid without a paid payment row of the same amount.
- **Cash on delivery** is the only payment method available in production. Staff record the cash on the order page; that is refused for online methods.
- A `testpay` adapter exists **only when `NODE_ENV=test`**. It is a stand-in online gateway with signed webhooks, used to test the framework end to end. It is not registered in development or production and is not a real provider.

Tests after Phase 4:

| Suite | Count | New in Phase 4 |
|---|---|---|
| `packages/shared` | 49 | Checkout, address and phone validation, delivery fee rules, order state machine |
| `packages/db` | 41 | RLS and cross-store foreign keys for the 8 new tables, total checks, append-only order events, paid-guard trigger |
| `apps/api` | 168 | Checkout rules, server-side totals, stock and oversell, idempotent and simultaneous submits, order tokens, state machine, cancel returns stock, permissions, cross-store access refused, encrypted credentials, webhook signature / replay / amount mismatch |
| `apps/e2e` (Playwright) | 56 | Merchant setup, shopper COD checkout with emails, private order link, merchant works the order to delivered and records cash, English pickup order cancelled with stock return, free delivery and minimum order, checkout and order pages in all five themes on desktop and mobile, dashboard order pages at phone width |

Mutation checks: removing the webhook amount check, the webhook signature check, or the "manual payment only for offline methods" rule each makes API tests fail.

**Planned for Phase 4 but not built** (nothing is faked in the UI):
- Coupons and discounts (Phase 8 with marketing).
- PDF invoices; delivery time slots.
- Customer accounts and saved addresses: checkout is guest-only.
- Redis/BullMQ and every background job: automatic cancellation of unpaid online orders, expired-cart cleanup, webhook processing through a queue (webhooks are processed inside the request today), page caching. These need Redis on a real server; they come with the first real gateway in Phase 5.
- Stock reservations with expiry: stock is taken when the order is placed and returned on cancel.
- Refunds and partial refunds (Phase 5, per provider). Order editing after placement.
- Address forms for countries other than Kuwait (phone rules exist for the six GCC countries; the address form is Kuwait-shaped).
- Per-zone area lists, COD fee, COD limits per zone.

## Phase 5 — Payment providers (in progress: Tap, MyFatoorah, Hesabe, Tabby and Deema built, others not started)

**Tap Payments: built.** Each merchant pastes their own Tap secret key in Dashboard → Delivery and payment; nothing is shared between stores and the platform holds no Tap account.

- The key must look like `sk_test_…` or `sk_live_…` and is checked with Tap before it is stored. A wrong key is refused; if Tap cannot be reached nothing is saved. The key is encrypted, never shown again, and the card shows **Test mode** or **Live mode**. Without a key the method stays **Pending configuration** and shoppers are not offered it.
- Checkout creates a Tap charge (`POST /v2/charges`, `source.id = src_all`, so Tap's hosted page offers whatever the merchant's Tap account has enabled: KNET, cards, Apple Pay) for the server-computed total and sends the shopper to Tap. If Tap refuses or is down, no order is created and no stock is taken.
- An order is marked paid only after the API reads the charge back from Tap with the merchant's key (`GET /v2/charges/{id}`) and the status is `CAPTURED` with our amount and currency. This happens when the shopper returns (`?tap_id=…` is only a hint) and when Tap's notification arrives; both go through the same settlement code, once.
- Failed, declined, cancelled or abandoned payments leave the order unpaid. The order page says so and offers **Pay now / Try again** (at most 5 attempts per order). A second payment arriving for an already-paid order is recorded as a duplicate for the merchant to refund in Tap.

How it was verified, honestly:
- **Automated tests** (18 API tests, 4 browser tests) run against a local stand-in for Tap (`apps/e2e/fake-tap.mjs`) that copies Tap's documented request and response shapes. They prove our logic, not Tap's behaviour.
- **Real Tap sandbox, by hand on 2026-11-13**, using the public test key printed in Tap's own documentation: a wrong key is answered with 401, a charge for 9.500 KWD with phone only was created and returned a `checkout.tap.company` payment page, and reading it back returned `INITIATED` with the same amount. `apps/api/scripts/tap-sandbox-check.cjs` repeats these checks through the adapter with any test key; it has **not** been run yet.
- **Not verified with real Tap:** a completed payment (nobody has paid on Tap's page), the return redirect, Tap's notification call and its `hashstring` (it needs a public server; the hash is computed and logged but payment decisions do not depend on it), live keys, refunds.

Not built: refunds from the dashboard, automatic cancellation of unpaid online orders (they stay pending and hold stock until the merchant cancels), reconciliation job, Redis/queue, choosing single methods (KNET only, card only), saved cards, Apple Pay domain setup.

**MyFatoorah: built.** Same principle: each merchant pastes their own API token (MyFatoorah portal → Integration Settings → API Key) and chooses the country of the account it belongs to, because MyFatoorah has a different API address per country.

- Accounts offered: demo (test), Kuwait, Bahrain, Oman, Saudi Arabia, UAE, Qatar. The account currency must be the store currency (a MyFatoorah invoice is always in the account's base currency); a mismatch is refused when saving. The token is checked with MyFatoorah before it is stored, encrypted, never shown again. Demo account shows **Test mode**, a country account **Live mode**.
- Checkout creates an invoice (`POST /v2/SendPayment`, `NotificationOption = LNK`) for the server-computed total and sends the shopper to MyFatoorah's invoice page (the methods enabled on the merchant's account).
- An order is paid only after the API reads the invoice back with the merchant's token (`POST /v2/GetPaymentStatus`) and it is `Paid` for our amount. This runs when the shopper returns and when a notification arrives (webhook v1 and v2 shapes are both understood; only the invoice id is taken from them, so MyFatoorah's separate webhook secret is not needed).
- Failed attempts, pay again, duplicate payments: same behaviour as Tap.

How it was verified, honestly:
- **Automated tests** (14 API tests, 3 browser tests) run against a local stand-in (`apps/e2e/fake-myfatoorah.mjs`) built from MyFatoorah's documentation.
- **Real MyFatoorah sandbox, by hand on 2026-11-13**, with the public test token printed in MyFatoorah's documentation: one `SendPayment` call with the same fields the adapter sends created an invoice and returned its page address. Nothing else was checked on the real sandbox.
- **Not verified with real MyFatoorah:** the token check call (`InitiatePayment`) and the HTTP status for a wrong token, `GetPaymentStatus` on a real invoice (the response shape is taken from the documentation), a completed payment, the redirect back, notifications, any live country account. Jordan and Egypt accounts are not offered (JOD and EGP are not store currencies yet).

**Hesabe: built.** Each merchant enters their own four values (merchant code, access code, secret key, IV key) and chooses sandbox or production; nothing is shared between merchants and all four are stored encrypted and never shown again.
- Requests and answers are AES-256-CBC, hex encoded, with the merchant's secret key and IV (`POST /checkout` with an `accesscode` header). Checkout sends the server-computed total in KWD; Hesabe is KWD only, so a store in another currency is refused with `payment_currency_mismatch`.
- Saving the keys runs one real checkout of 1.000 KWD with reference `mtjari-key-check`. That is the only call that proves all four values together. It leaves one unpaid transaction in the merchant's Hesabe panel that nobody can pay (the dashboard says so).
- An order is paid only after the API reads the transaction back (`GET /api/transaction/{token}` with the merchant's access code) and it is `SUCCESSFUL` for the same amount, using only tokens we created for that order. Hesabe answers 404 for an unpaid transaction, which we treat as "not yet". The notification body and the `data` return parameter are only hints; we read only the transaction token from the notification and never decrypt the return parameter.
- **Automated tests** (14 API tests, 3 browser tests) run against a local stand-in (`apps/e2e/fake-hesabe.mjs`) built from Hesabe's documentation. Mutation checks (treat any status as paid; trust the notification body) make the tests fail.
- **Real Hesabe sandbox, by hand on 2026-11-13**, with the public keys in Hesabe's documentation: the AES format, a checkout creation, an unpaid transaction enquiry giving 404, and a wrong access code giving 401. A probe with a wrong secret key was blocked by the tooling and was not run.
- **Not verified with real Hesabe:** the enquiry answer for a paid or failed transaction (shape and status words are from the documentation), the notification body, the return parameters, what Hesabe answers to a wrong secret key, production, refunds. The failed-status word list is a guess to be confirmed.

**Tabby: built** (instalments, "pay in 4"). Each merchant enters their own secret key and merchant code and chooses the account region (`api.tabby.ai` or `api.tabby.sa`); nothing is shared between merchants.
- Checkout sends a full session (`POST /api/v2/checkout`): buyer, address, the ordered items and the delivery fee, with the server-computed total. Tabby needs an email, so checkout answers `payment_email_required` for a shopper without one, and `payment_not_approved` when Tabby declines the buyer; in both cases no order and no stock are taken.
- An order is paid only after the API reads the payment back (`GET /api/v2/payments/{id}`) with the merchant's key and it is `AUTHORIZED` (or `CLOSED` with the full amount captured) for the same amount and currency. `REJECTED` and `EXPIRED` are failures; `CLOSED` without a capture (cancelled) is not paid. The notification body and the `payment_id` return parameter are only hints.
- After a verified `AUTHORIZED` payment is recorded, the API captures it (`POST .../captures`, idempotent with `reference_id = capture-{payment id}`) so Tabby settles it. A capture is never attempted for an event that was ignored, a duplicate, or refused (amount mismatch). If the capture call fails the order stays paid and confirmed and the failure is logged; the merchant can capture from the Tabby dashboard and Tabby captures on its own after 21 days. There is no automatic retry yet.
- Saving the keys sends the documented minimal session (a `created` or `rejected` answer both prove the key and merchant code; 401 means refused) and registers our notification address with Tabby unless it is already listed. Registration failure is logged and does not block saving.
- **Automated tests** (16 API tests, 4 browser tests) run against a local stand-in (`apps/e2e/fake-tabby.mjs`) built from Tabby's documentation. Mutation checks (treat a cancelled payment as paid; capture on any event; never capture) make the tests fail.
- **Not verified with real Tabby** (no test key exists in this project and none is public): everything. The paths, payload and response shapes come from docs.tabby.ai and its OpenAPI file only. Also unverified: that Kuwait merchants use `api.tabby.ai` (the docs name only a UAE and a KSA address), whether `KWD` is accepted for a given merchant code, the webhook-list response shape used to avoid duplicate registration, and refunds. Tabby requires its QA review and its on-site promo snippets before go-live; neither is built.

**Deema: built** (buy now, pay later, Kuwait). Each merchant enters their own API key and chooses sandbox or production; nothing is shared. KWD only (other store currencies are refused with `payment_currency_mismatch`).
- Checkout creates a Deema order (`POST /api/merchant/v1/purchase`) for the server-computed total. The documentation names no return parameters, so the success and failure addresses carry our own `pay_return=1`, which makes the order page ask the API what happened. A customer Deema will not serve gets `payment_not_approved` and no order or stock is taken.
- An order is paid only after the API reads the order back (`GET /purchase/{order_reference}/retrieve_by_reference`, which returns status, amount and currency) with the merchant's key and it is `captured` or `fully_captured` for the same amount and currency. `authorized`, `pending` and partial or refunded states are not a payment; `declined*`, `payment_cancelled` and `expired` are failures. Notifications are only hints: we take `order_ref` from the body and read the order back.
- Saving the key looks up an order that cannot exist: a wrong key gets 401, a good one gets 404 "Purchase not found". Nothing is created in the merchant's account.
- Deema has no API to register notifications, so the dashboard shows the merchant the exact address to enter in the Webhook section of their Deema portal. Until they do, payments are still found when the shopper returns to the shop.
- Base addresses: the current reference (docs.deema.me) names `sandbox-api.deema.me` and `api.deema.me`; an older page (api-docs.deema.me) still shows `staging-api.deema.me`. We use the current one.
- **Automated tests** (14 API tests, 3 browser tests) run against a local stand-in (`apps/e2e/fake-deema.mjs`) built from Deema's documentation. Mutation checks (treat `authorized` as paid; trust the notification body) make the tests fail.
- **Not verified with real Deema** (no sandbox key exists in this project and none is public): everything. All shapes are from docs.deema.me only. In particular: the exact `Authorization: Basic {API Key}` format (the key is sent as given, not base64-encoded, as the docs say), the 401/404 behaviour used to check a key, the notification body and its retries, which status a finished payment really ends in, and refunds and cancellation (not built). Deema requires a sandbox test (one payment, a cancel and a refund in its portal, webhook received) and its widget on the live site before go-live; the widget is not built.

**Next providers** (not started): Tamara, Taly, each as one adapter behind the same interface. See PAYMENT_INTEGRATIONS.md.

Tests after the MyFatoorah work: `packages/shared` 49, `packages/db` 41, `apps/api` 214 (after Hesabe), Playwright 66. After Tabby: `apps/api` 230, Playwright 70. After Deema: `apps/api` 244, Playwright 73.

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
| Deployment | VPS (min. 4 vCPU / 8 GB), DNS control of mtjari.cc incl. wildcard `*.mtjari.cc` | Now, for staging and custom domains |
| Media | S3-compatible bucket + CDN | Phase 2 staging |
| Payments | Merchant/sandbox accounts per provider | Phase 5 |
| Google | Google Cloud project with OAuth consent screen, Ads developer token, Merchant API access | Phase 7 |
| Messaging | SMS and WhatsApp Business provider accounts | Phase 8 |
