# Mtjari.cc — Security Checklist

Legend: ✅ implemented and covered by automated tests · 🟡 implemented, not yet verified in a real deployment · ⬜ planned (phase in brackets).

## Tenant isolation
- ✅ Row-Level Security on every tenant table, default deny without a tenant context
- ✅ API runs as a non-owner, `NOBYPASSRLS` role and refuses to start otherwise
- ✅ Transaction-local tenant context (no leakage across pooled connections; tested under concurrency)
- ✅ `WITH CHECK` prevents writing or moving rows into another store
- ✅ Non-members get 404 on every store route; ids from another store are rejected inside valid routes
- ✅ Mutation check: disabling RLS on one table makes 10 isolation tests fail (verified manually on 2026-11-13)
- ⬜ Isolation tests extended for each new tenant table (every phase)

## Authentication
- ✅ argon2id password hashing; rehash on login when parameters change
- ✅ Minimum 10-character passwords, max 128
- ✅ Email verification (single-use, hashed, 24 h) before a store can be created
- ✅ No account enumeration on register, login or password reset
- ✅ Account lockout after repeated failures; per-IP rate limit on auth routes
- ✅ Short-lived access tokens checked against the session table on every request
- ✅ Refresh-token rotation with reuse detection (family revocation)
- ✅ TOTP MFA with encrypted secret and single-use recovery codes
- ✅ Password reset revokes all sessions
- ✅ Browser tokens only in httpOnly, SameSite=Lax cookies (Secure in production)
- ⬜ Breached-password check (k-anonymity API) (Phase 10)
- ⬜ Mandatory MFA for super admins; optional enforcement per store (Phase 9)
- ⬜ New-device login email (Phase 8)

## Authorization
- ✅ Permission required on every store route, evaluated server-side per request
- ✅ No privilege escalation: cannot grant permissions you lack, cannot grant owner unless owner
- ✅ Last owner cannot leave or be demoted; system roles immutable
- ✅ Invitations bound to the invited email, single use, expiring, revocable
- ⬜ Plan limits enforced in API guards (Phase 9)

## Data protection
- ✅ AES-256-GCM envelope encryption with key ids for rotation and owner binding (AAD)
- ✅ Random tokens stored only as SHA-256 hashes
- ✅ Secrets come from environment variables validated at startup; none in the repository
- ✅ Log redaction for authorization headers, cookies, passwords, tokens
- ✅ Audit metadata redaction for credential-like keys
- 🟡 Encrypted nightly backups (`infra/scripts/backup.sh`, uses `age`)
- ⬜ Per-store encrypted payment credentials using the same envelope, never returned by the API after save (Phase 4)
- ⬜ Disk encryption on the VPS / managed volume (Phase 10, hosting-dependent)
- ⬜ Data export and deletion flows for customers (Phase 8)

## Web application
- ✅ SQL injection: parameterised queries only (Prisma); the one raw helper validates UUIDs first
- ✅ Input validation with shared Zod schemas; unknown fields rejected on updates
- ✅ CSRF: no ambient-credential API (bearer tokens server-side only); mutations go through Next.js server actions, which verify Origin
- ✅ XSS: React escaping, no `dangerouslySetInnerHTML`, user input escaped in emails
- ✅ Security headers: helmet on the API; nosniff, frame deny, referrer and permissions policy on the web
- ✅ Email links require a click (POST) so mail scanners cannot burn tokens
- 🟡 HSTS and TLS 1.2+ in the nginx template
- ⬜ Content-Security-Policy with nonces (Phase 3, together with the storefront)
- ⬜ Sanitised merchant custom CSS (allow-list parser, no `url()` to foreign origins, no `@import`) (Phase 6)
- ⬜ Upload validation: type sniffing, size limits, image re-encoding, signed URLs (Phase 2)

## Payments (Phases 4–5)
- ⬜ Hosted checkout or tokenization only; no PAN/CVV touches Mtjari servers (keeps PCI scope at SAQ-A)
- ⬜ Webhook signature verification per provider; reject unsigned/expired
- ⬜ Idempotent processing: unique provider event id and idempotency keys
- ⬜ Order marked paid only after server-side verification with the provider, never from a browser redirect
- ⬜ Amount and currency re-checked against the order on every callback
- ⬜ Reconciliation job comparing provider reports with local payments

## Audit and monitoring
- ✅ Append-only audit log (no UPDATE/DELETE grant), written in the same transaction as the change
- ✅ Auth events audited (login success/failure, lockout, token reuse, MFA changes, password reset)
- ✅ Request ids in logs and audit entries
- ⬜ Error tracking (Sentry or self-hosted GlitchTip), uptime checks, alerting (Phase 10)
- ⬜ Audit log partitioning and retention policy (Phase 9)

## Infrastructure
- 🟡 Only nginx is published; database, Redis and API stay on the internal Docker network
- 🟡 Containers run as non-root
- 🟡 Real client IP: nginx overwrites `X-Forwarded-For`; API trusts exactly one hop
- ⬜ Firewall (ufw), fail2ban, SSH keys only, unattended upgrades (Phase 10, on the VPS)
- ⬜ Dependency and image scanning in CI (Phase 10)
- ⬜ Restore drill for backups, documented RPO/RTO (Phase 10)
- ⬜ Load test and external penetration test before public launch (Phase 10)

## Catalogue and uploads (Phase 2)
- [x] Every catalogue table has RLS; a test fails the build if a table with `store_id` is added without a policy.
- [x] Composite `(store_id, id)` foreign keys; brand, category and parent references are also checked in the service.
- [x] Uploaded images are decoded and re-encoded (content is checked, not the file name or MIME header); metadata removed; size and count limits; file names are generated by the server.
- [x] Media files are served with `nosniff`; directory listing and dotfiles are refused.
- [x] CSV export neutralises cells starting with `= + - @`; import is limited in size and rows.
- [x] Stock changes are serialised with a row lock and recorded in an append-only ledger.
- [x] Product, variant, image, stock and import actions are written to the audit log.
- [ ] S3 driver has not been exercised against a real bucket.
- [ ] No antivirus scan of uploads (images are re-encoded, other file types are not accepted).

## Storefront (Phase 3)
- [x] The shop is chosen by hostname on the server, never by a client-supplied store id; all storefront queries run under that store's RLS context.
- [x] Unlaunched, suspended and unknown shops return 404; only ACTIVE products are exposed, without cost price or exact stock figures.
- [x] Cart token is random, stored hashed, httpOnly cookie; a token from one shop is useless on another; prices are never taken from the client.
- [x] Preview tokens are HMAC-signed, bound to store and theme, expire in 30 minutes, live in an httpOnly cookie and are removed from the URL.
- [x] Theme settings accept plain text and hex colours only (no markup, no CSS, no URLs).
- [x] Dashboard and auth pages are not served on shop hosts; internal `/s/...` routes are closed.
- [x] Search input is escaped for LIKE wildcards; public API has its own per-IP rate limit (`STOREFRONT_THROTTLE_LIMIT`).
- [ ] Rate limiting per shopper IP depends on nginx setting `X-Forwarded-For`; not yet verified on a real server.
- [ ] Cart cookies are per host, so a shop's subdomain and its custom domain have separate carts.

## Checkout, orders and payments (Phase 4)
- [x] Checkout accepts no prices, totals or store id from the client; totals are computed from the catalogue and the delivery zone inside the order transaction.
- [x] Stock is taken in the same transaction as the order with row locks; two shoppers cannot both buy the last unit.
- [x] Double submits are idempotent (same key returns the same order).
- [x] Order page token is random (43 characters), stored hashed, scoped to the shop; pages are noindex with no referrer.
- [x] Order status changes follow a fixed state machine on the server; order events are append-only; orders cannot be deleted by the application role.
- [x] Payment credentials are encrypted (AES-256-GCM, bound to store and provider), never returned by the API, never logged.
- [x] An order is marked paid only by a signature-verified webhook whose amount and currency match, or by staff for offline methods; a database trigger enforces a matching paid payment row.
- [x] Webhook events are deduplicated per store and provider; replays change nothing.
- [x] Checkout has its own per-IP rate limit (`CHECKOUT_THROTTLE_LIMIT`, default 20 per minute).
- [x] Tap: each store uses its own secret key (checked with Tap before it is stored); an order is paid only after the charge is read back from Tap with that key and is `CAPTURED` for our amount and currency. A forged notification or a made-up `tap_id` in the address cannot pay an order; one store's key cannot settle another store's charge.
- [x] Shoppers are redirected only to `https` payment pages (the local test stand-in needs an explicit `ALLOW_LOCAL_PAYMENT_PAGE=1`, set only by the browser tests).
- [x] MyFatoorah: same rule as Tap. An order is paid only after the invoice is read back with the store's own token and is `Paid` for our amount; notifications and return parameters are hints only; the account currency must equal the store currency.
- [x] Hesabe: same rule. An order is paid only after the transaction is read back with the store's own access code and is `SUCCESSFUL` for our amount; the notification and the return `data` parameter are never trusted. All four keys are encrypted and never returned.
- [ ] Hesabe has been exercised on its real sandbox for checkout creation and unpaid enquiry only; paid status, notifications and a wrong secret key are unverified.
- [ ] MyFatoorah has been exercised on its real sandbox for invoice creation only; status reading and a completed payment are unverified.
- [ ] Tap's notification `hashstring` has not been checked against a real notification (needs a public server). Decisions do not depend on it.
- [ ] A completed Tap payment has not been observed end to end on the real sandbox.
- [ ] No CAPTCHA or phone verification on guest checkout: a bot can place fake COD orders up to the rate limit, holding stock until the merchant cancels.
- [ ] Unpaid online orders are not cancelled automatically (no background worker yet).

## Known limitations today
- Images uploaded with the local storage driver live on one server's disk; use the S3 driver before running more than one API instance.
- Rate-limit counters and the web tier's refresh single-flight are in process memory. Fine for one instance of each; both move to Redis before horizontal scaling (Phase 5, when Redis is introduced).
- `MAIL_TRANSPORT=log` exists for local development and does not deliver mail; production startup rejects it.
