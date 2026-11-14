# Mtjari.cc — Deployment

Status: the files referenced here exist (`infra/`, `.github/workflows/ci.yml`) but **have not yet been run on a real server or in GitHub Actions**. The local, non-Docker path below is what was actually used to build and test Phase 1. Treat the VPS section as a runbook to validate in Phase 10 (or earlier for staging).

## 1. Local development (verified)

Requirements: Node 22, pnpm 10, PostgreSQL 16. Docker is optional (`docker compose up -d` starts Postgres, Redis and Mailpit).

```bash
pnpm install
cp .env.example .env            # fill in passwords and secrets (see comments in the file)

# Create the two database roles and the dev + test databases (run as a Postgres superuser)
OWNER_PASSWORD=... APP_PASSWORD=... DB_NAME=mtjari      ./infra/postgres/bootstrap.sh
OWNER_PASSWORD=... APP_PASSWORD=... DB_NAME=mtjari_test ./infra/postgres/bootstrap.sh

cp .env packages/db/.env && cp .env apps/api/.env
pnpm db:migrate                                         # dev database
DATABASE_OWNER_URL=$TEST_DATABASE_OWNER_URL pnpm db:migrate   # test database
pnpm build
pnpm db:seed                    # optional demo merchant; prints a generated password once
pnpm dev                        # API on :4000, web on :3000
```

Email in development: point `SMTP_URL` at Mailpit (`smtp://localhost:1025`, inbox at http://localhost:8025), or set `MAIL_TRANSPORT=log` (links are then not delivered anywhere).

Tests:

```bash
pnpm test                               # shared + db (RLS) + api (unit and HTTP)
pnpm --filter @mtjari/e2e e2e           # Playwright; needs `pnpm build` first
```

## 2. Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | API | **Must** be the `mtjari_app` role. The API exits at startup if the role can bypass RLS |
| `DATABASE_OWNER_URL` | Migrations only | `mtjari_owner`; never given to the API container |
| `JWT_ACCESS_SECRET` | API | ≥ 32 chars, `openssl rand -hex 32` |
| `ENCRYPTION_KEYS` | API | `v1:<base64 32 bytes>`; to rotate, prepend `v2:...` and keep the old entry |
| `WEB_URL`, `ROOT_DOMAIN`, `CORS_ORIGINS` | API | Public URL of the web app, root domain for store subdomains |
| `TRUST_PROXY_HOPS` | API | `1` behind nginx → web → API as configured here |
| `SMTP_URL`, `MAIL_FROM`, `MAIL_TRANSPORT` | API | Production requires `smtp` |
| `API_URL` | Web | Internal URL of the API |
| `ROOT_DOMAIN`, `PLATFORM_HOSTS` | Web | `ROOT_DOMAIN` must match the API's. Hosts other than `ROOT_DOMAIN`, `www.ROOT_DOMAIN` and the comma-separated `PLATFORM_HOSTS` are treated as shops |
| `STOREFRONT_THROTTLE_LIMIT` | API | Public shop API requests per minute per IP (default 600) |
| `CHECKOUT_THROTTLE_LIMIT` | API | Orders placed per minute per IP (default 20) |
| `API_PUBLIC_URL` | API | Public https address of the API, given to payment providers for notifications (e.g. `https://api.mtjari.cc`). Without it, online payments are confirmed only when the shopper returns to the shop |
| `DEEMA_API_URL` | API | Tests only: replaces Deema's sandbox and production addresses. Leave unset in production |
| `TABBY_API_URL` | API | Tests only: replaces Tabby's regional addresses. Leave unset in production |
| `HESABE_API_URL` | API | Tests only: replaces Hesabe's sandbox and production addresses. Leave unset in production |
| `MYFATOORAH_API_URL` | API | Tests only: replaces MyFatoorah's per-country API addresses. Leave unset in production |
| `TAP_API_URL` | API | Tap API base address (default `https://api.tap.company`; changed only by tests) |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `STORAGE_PUBLIC_URL` | API | `local` (default; files on the `media` volume, nginx proxies `/media/` to the API) or `s3`. `STORAGE_PUBLIC_URL` is the public base URL of images |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | API | Only with `STORAGE_DRIVER=s3`. Not yet tested against a real bucket |
| `THROTTLE_LIMIT`, `AUTH_THROTTLE_LIMIT`, `LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`, `MAX_STORES_PER_USER` | API | Optional tuning |

Secrets live in `.env.production` on the server (mode 600, owned by the deploy user) or in a secrets manager; never in git, images or logs.

## 3. Single-VPS production (runbook, to be validated)

Sizing to start: 4 vCPU, 8 GB RAM, 80 GB SSD, Ubuntu 24.04. Gulf-region or nearby data centre for latency.

1. **Harden the host**: non-root deploy user, SSH keys only, `ufw allow 22,80,443`, fail2ban, unattended-upgrades, Docker Engine + compose plugin.
2. **DNS**: `A mtjari.cc`, `A *.mtjari.cc` → server IP. Mail: SPF, DKIM and DMARC records from your email provider.
3. **Secrets**: create `.env.production` with `ROOT_DOMAIN`, `POSTGRES_SUPERUSER_PASSWORD`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`, `ENCRYPTION_KEYS`, `SMTP_URL`, `MAIL_FROM`.
4. **TLS**: issue a certificate for `mtjari.cc` and `*.mtjari.cc` with certbot using a DNS-01 challenge (wildcards require DNS validation) into the `certs` volume; renew by timer.
5. **Start**:
   ```bash
   docker compose -f infra/docker/compose.prod.yml --env-file .env.production up -d --build
   ```
   Order is enforced by compose: Postgres → `bootstrap` (roles, idempotent) → `migrate` (owner role) → `api` → `web` → `nginx`.
6. **Verify**: `curl https://mtjari.cc/ar`, API health from inside the network, sign up with a real mailbox.

### Shop subdomains (Phase 3)

The nginx template serves `*.ROOT_DOMAIN` with the wildcard certificate and passes the original `Host` header to the web container, which decides whether the host is the platform or a shop. This is tested locally with `*.localhost`; the nginx and DNS part has not been run on a server yet.

### Custom merchant domains (not built yet)

Wildcard certificates cover `*.mtjari.cc` only. Custom domains need per-domain certificates issued on demand. Plan: replace or front nginx with **Caddy on-demand TLS** (or Traefik with an ACME resolver), with an "ask" endpoint on the API that approves issuance only for hostnames in `store_domains` with status `VERIFIED`. Flow: merchant adds domain → dashboard shows the CNAME/A and TXT records → API verifies the TXT token → status `VERIFIED` → first HTTPS request triggers issuance → status `ACTIVE`; renewal is automatic.

## 4. Backups and recovery

- `infra/scripts/backup.sh`: nightly `pg_dump` (custom format), encrypted with `age`, optional upload to S3-compatible storage, 14-day local retention. Schedule with cron or a systemd timer.
- Add WAL archiving (pgBackRest or WAL-G) before real merchant data exists, for point-in-time recovery.
- Uploaded media: with `STORAGE_DRIVER=s3`, enable bucket versioning. With the local driver the `media` Docker volume is **not** covered by `backup.sh` (database only) and must be backed up separately, e.g. a nightly `tar` of the volume.
- Restore drill (Phase 10): restore the latest dump into a scratch database, run migrations and the test suite against it, record the time taken. Target RPO ≤ 24 h with dumps alone, ≤ 5 min with WAL archiving; RTO ≤ 1 h.
- Keep `ENCRYPTION_KEYS` backed up separately from database backups: without it, encrypted columns (MFA secrets, later payment credentials) cannot be read.

## 5. CI/CD

- `ci.yml`: on every push and pull request: install, create throwaway DB roles, migrate, build, typecheck, all test suites, Playwright.
- Deployment (to add when a server exists): build images on tag, push to a registry, SSH to the server, `compose pull && compose up -d`. Migrations run as their own step before the API is replaced; schema changes follow expand → backfill → contract so old and new API versions can overlap.

## 6. Monitoring (Phase 10)

Uptime checks on `/v1/health` and the home page, error tracking (Sentry or GlitchTip), log shipping (Loki or a hosted service), Postgres metrics (connections, slow queries, bloat), disk and certificate-expiry alerts.

## 7. Scaling beyond one server

1. Move Postgres to a managed service or dedicated host; add PgBouncer (transaction pooling is compatible with the RLS design).
2. Run 2+ API and web containers behind the proxy. Before that: move rate-limit counters and the web tier's token-refresh single-flight to Redis.
3. Separate worker containers per queue; CDN in front of storefront and media.
4. Read replicas for storefront reads; partition large append-only tables.
