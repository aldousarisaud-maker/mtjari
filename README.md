# Mtjari.cc — متجري

Multi-tenant e-commerce SaaS for Kuwait and the Gulf. Arabic-first (RTL) with English.

**Status: Phase 1 of 10 complete** — accounts, stores (tenants) with strict database-level isolation, teams, roles and permissions, audit log. Products, storefront, checkout, payments and themes are not built yet; see [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Documents

| | |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, tenancy model, auth, RBAC, audit |
| [DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Tables, RLS policies, planned schema per phase |
| [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Phases, current status, what each phase needs |
| [PAYMENT_INTEGRATIONS.md](docs/PAYMENT_INTEGRATIONS.md) | Adapter design and per-provider requirements |
| [THEME_SYSTEM.md](docs/THEME_SYSTEM.md) | Theme contract, the 25 templates, visual builder |
| [SEO_STRATEGY.md](docs/SEO_STRATEGY.md) | Technical SEO, Core Web Vitals, Google integrations |
| [SECURITY_CHECKLIST.md](docs/SECURITY_CHECKLIST.md) | What is implemented, tested, and still open |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Local setup, environment, VPS runbook, backups |

## Repository

```
apps/api        NestJS REST API (auth, stores, members, roles, audit)
apps/web        Next.js app (landing, auth, merchant dashboard)
apps/e2e        Playwright browser tests + local SMTP sink
packages/db     Prisma schema, SQL migrations with Row-Level Security, seed
packages/shared Validation schemas, permission catalogue, slug rules
infra/          Postgres bootstrap, Dockerfiles, compose, nginx, backup script
docs/           Planning documents
```

## Quick start

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#1-local-development-verified). In short: Node 22, pnpm 10, PostgreSQL 16; copy `.env.example` to `.env`, run `infra/postgres/bootstrap.sh`, `pnpm install && pnpm db:migrate && pnpm build && pnpm dev`.

## Tests

```bash
pnpm test                       # 199 tests: validation, money, CSV, themes, RLS isolation, API unit + HTTP
pnpm --filter @mtjari/e2e e2e   # 48 browser tests: dashboard and storefront journeys, all five themes (desktop and mobile)
```

All suites run against a real PostgreSQL database using the same restricted role as production; browser tests also use real SMTP delivery to a local sink.

## API (Phases 1–3)

| Area | Endpoints |
|---|---|
| Auth | `POST /v1/auth/{register,verify-email,resend-verification,login,refresh,logout,logout-all,forgot-password,reset-password}`, `POST /v1/auth/mfa/{setup,enable,disable}`, `GET /v1/me` |
| Stores | `GET /v1/stores/slug-availability`, `POST /v1/stores`, `GET/PATCH/DELETE /v1/stores/:storeId` |
| Team | `GET /v1/stores/:storeId/members`, `PATCH/DELETE .../members/:id`, `POST .../leave`, `GET/POST .../invitations`, `DELETE .../invitations/:id`, `POST /v1/invitations/accept` |
| Roles | `GET/POST /v1/stores/:storeId/roles`, `GET .../roles/permissions`, `PUT/DELETE .../roles/:id` |
| Audit | `GET /v1/stores/:storeId/audit-logs` |
| Catalogue | `GET/POST .../categories`, `PATCH/DELETE .../categories/:id`, same for `brands`; `GET/POST .../products`, `GET/PATCH/DELETE .../products/:id`, `PUT .../products/:id/variants`, `PUT .../products/:id/relations`, `POST .../products/:id/media`, `PATCH/DELETE .../products/:id/media/:mediaId`, `GET .../products/export`, `POST .../products/import`, `GET .../catalog/summary` |
| Inventory | `GET .../inventory`, `POST .../inventory/adjust`, `GET .../inventory/movements` |
| Theme and launch | `GET .../theme`, `POST .../theme/draft`, `POST .../theme/publish`, `POST .../theme/preview-token`, `POST .../launch`, `POST .../unlaunch` |
| Storefront (public, by `x-store-host`) | `GET /v1/storefront/{store,products,products/:slug,sitemap,cart}`, `POST /v1/storefront/cart/items`, `PATCH /v1/storefront/cart/items/:id` |
| Ops | `GET /v1/health` |
