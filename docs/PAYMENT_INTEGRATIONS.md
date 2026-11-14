# Mtjari.cc — Payment Integrations

Status: **Cash on Delivery, Tap Payments, MyFatoorah, Hesabe, Tabby and Deema are built.** Tap and MyFatoorah were built from their official documentation and only partly checked on their real sandboxes (see their sections below for exactly what was and was not verified). The other providers are not started; their details below are from general knowledge and have **not** been re-verified against each provider's current documentation.

## Principles

1. Every provider is an isolated module implementing one interface. Stores enable any combination; nothing is shared between stores.
2. Mtjari never sees card numbers: hosted payment page, redirect, or provider-hosted fields/tokens only.
3. An order is marked paid only after the server verifies the payment with the provider (verified webhook, or a server-to-server status call). A browser returning to a "success" URL proves nothing.
4. Webhooks are verified, stored raw, deduplicated by provider event id, and processed idempotently through a queue.
5. A gateway without valid credentials shows **Pending configuration**. A gateway whose integration is not built shows **Not available yet**. Nothing reports success without a real provider response.

## Adapter contract (built in Phase 4)

`apps/api/src/orders/payment-adapters.ts`:

```ts
interface PaymentAdapter {
  readonly id: string;                         // 'cod', later 'tap', 'myfatoorah', ...
  readonly kind: 'offline' | 'online';
  readonly name: { ar: string; en: string };
  readonly credentialFields: readonly { key: string; label: { ar; en } }[];   // drives the settings form
  initiate?(input: InitiateInput): Promise<{ providerRef: string; redirectUrl: string | null }>;   // order, amount, customer, returnUrl, webhookUrl
  verifyWebhook?(input: { rawBody: Buffer; headers; credentials }): VerifiedWebhook | Promise<VerifiedWebhook>;   // throws when it cannot be trusted
  fetchStatus?(input: { providerRef; credentials }): Promise<VerifiedWebhook>;   // the provider's own answer
  checkCredentials?(credentials): Promise<{ mode: 'test' | 'live' }>;
  mode?(credentials): 'test' | 'live' | null;
}
```

What exists around it today:
- **Credential vault**: AES-256-GCM, bound to store id and provider, write-only from the dashboard. A method with missing credentials shows **Pending configuration** and cannot be used at checkout.
- **Webhook endpoint**: `POST /v1/webhooks/payments/:provider/:storeId`. The signature is verified on the raw request body with that store's own secret; each provider event id is recorded once per store (`webhook_events`), so replays do nothing; the amount and currency must equal our payment record; only then is the order marked paid.
- **Database guard**: an order cannot become `PAID` without a `PAID` payment row of the same amount and currency.
- **Payment states**: `PENDING`, `PAID`, `FAILED`, `CANCELLED`, `REFUNDED` (refund flow itself is not built).
- **Offline methods**: staff record the payment on the order page; this is refused for online methods.
- **Test gateway (`testpay`)**: registered only when `NODE_ENV=test`, to exercise the online path in automated tests. It is not a provider and never appears in development or production.

Added with Tap: `checkCredentials` (key check on save), `fetchStatus` (server-to-server status check), `mode` (test/live). Still to add: reconciliation job, `refund`, sandbox/live modes, capability checks (currency/country), queue-based webhook processing, automatic cancellation of unpaid online orders, per-store ordering and display names.

## Tap Payments (built)

Source: https://developers.tap.company (Create a Charge, Redirect, Webhook, API endpoint pages, read 2026-11-13).

| Step | What happens |
|---|---|
| Merchant setup | Pastes the secret key from Tap dashboard → goSell → API Credentials. Format check, then an authenticated call to Tap; a 401 means the key is refused. Stored encrypted; test/live shown from the key prefix. |
| Start payment | `POST {TAP_API_URL}/v2/charges` with `Authorization: Bearer <merchant key>`, header `lang_code`, amount in major units (3 decimals for KWD), `source.id = src_all`, `redirect.url` = the private order page, `post.url` = `{API_PUBLIC_URL}/v1/webhooks/payments/tap/{storeId}` when `API_PUBLIC_URL` is set. The shopper is sent to `transaction.url`. |
| Shopper returns | Tap adds `?tap_id=chg_…`. The web app calls `POST /v1/storefront/orders/:token/sync-payment`; the API reads a charge **that it created for this order** from Tap and settles. |
| Notification | Tap posts the charge to `post.url`. We take only the charge id from it, read the charge from Tap with the store's key, and settle. The documented `hashstring` (HMAC-SHA256 with the secret key) is computed and a mismatch is logged, but it is not what the decision rests on, because it could not be checked against a real notification yet. |
| Paid | Only `CAPTURED` with the same amount and currency as our payment record. `ABANDONED, CANCELLED, FAILED, DECLINED, RESTRICTED, VOID, TIMEDOUT` mark the attempt failed; anything else is ignored. |
| Retry | `POST /v1/storefront/orders/:token/pay` creates a new charge for an unpaid, pending order (5 attempts at most). |

Environment: `TAP_API_URL` (default `https://api.tap.company`), `API_PUBLIC_URL` (public address of the API; without it Tap gets no notification address and payments are confirmed only when the shopper returns to the shop).

Verified on the real sandbox: key rejection (401), charge creation, reading an unpaid charge. Not yet verified: a completed payment, the redirect back, the notification and its hash, live mode. To verify on a server: enter a Tap test key in a store, pay with a Tap test card, and watch the API log for `hashstring missing or different`.

## MyFatoorah (built)

Source: https://docs.myfatoorah.com (API Key, SendPayment, GetPaymentStatus, Webhook, Webhook V2 pages, read 2026-11-13).

| Step | What happens |
|---|---|
| Merchant setup | Pastes the API token and chooses the account: demo, KW, BH, OM (`api.myfatoorah.com`), SA (`api-sa`), AE (`api-ae`), QA (`api-qa`); demo uses `apitest.myfatoorah.com`. The account currency must equal the store currency. The token is checked with `POST /v2/InitiatePayment`; 401 means refused. Stored encrypted. |
| Start payment | `POST /v2/SendPayment` with `Authorization: Bearer <token>`: `NotificationOption: LNK`, `InvoiceValue` in major units, `DisplayCurrencyIso`, customer name/mobile/email, `Language`, `CustomerReference` = our order id, `CallBackUrl` and `ErrorUrl` = the private order page, `WebhookUrl` when `API_PUBLIC_URL` is https. The shopper is sent to `InvoiceURL`; we keep `InvoiceId`. |
| Shopper returns | MyFatoorah adds `?paymentId=…`. The web app calls `sync-payment`; the API reads the invoices **it created for this order** and settles. |
| Notification | From the body we take only the invoice id (`Data.Invoice.Id` in v2, `Data.InvoiceId` in v1), then call `GetPaymentStatus`. The `myfatoorah-signature` header is not used. |
| Paid | `InvoiceStatus = Paid` and `InvoiceValue` equal to our amount. `Canceled`, or `Pending` with only failed attempts, marks the attempt failed (a later payment of the same invoice still pays the order). |

Limits: MyFatoorah does not allow `localhost` return addresses and needs https for webhooks, so this can only be tried end to end on a real server. Verified on the real sandbox: one `SendPayment` call. Everything else follows the documentation and is unverified.

## Hesabe (built)

Source: https://developer.hesabe.com (checkout, transaction enquiry, encryption pages, read 2026-11-13).

| Step | What happens |
|---|---|
| Merchant setup | Enters merchant code, access code, secret key (32 characters), IV (16 characters) and environment (`sandbox.hesabe.com` or `api.hesabe.com`). All encrypted at rest, never returned. Saving runs one 1.000 KWD test checkout. |
| Checkout | The JSON payload is AES-256-CBC encrypted (hex) and posted to `/checkout` with the `accesscode` header. The answer holds the transaction `token` and the data for `/payment?data=…`, where the shopper is sent. KWD only. |
| Shopper returns | Hesabe adds an encrypted `data` parameter. We do not read it: the API reads the transactions **it created for this order** with `GET /api/transaction/{token}`. 404 means unpaid. |
| Notification | Only `token` is taken from the body, then the enquiry call decides. |

Not verified: see IMPLEMENTATION_PLAN.md (Hesabe).

## Tabby (built)

Source: https://docs.tabby.ai (checkout flow, payment processing, statuses, webhooks, OpenAPI file, read 2026-11-14).

| Step | What happens |
|---|---|
| Merchant setup | Secret key (`sk_test_…` or live), merchant code, region (`api.tabby.ai` / `api.tabby.sa`). Encrypted, never returned. Saving runs the minimal session call and registers our webhook address. |
| Checkout | Full session with buyer, address, items, shipping. The shopper needs an email. Redirect to `configuration.available_products.installments[0].web_url`. |
| Shopper returns | Tabby appends `payment_id`. We do not trust it: the API reads the payments **it created for this order**. |
| Paid | `AUTHORIZED` for our amount marks the order paid, then we capture it (idempotent). `CLOSED` counts only with the full amount captured. |
| Notification | Only the payment `id` is taken from the body, then the payment API decides. |

Not verified with real Tabby: everything (see IMPLEMENTATION_PLAN.md). Go-live also needs Tabby's QA review and promo snippets.

## Deema (built)

Source: https://docs.deema.me (Getting Started, Create Online Checkout, Retrieve Order Details, Order Statuses, Post Checkout Webhook, read 2026-11-14).

| Step | What happens |
|---|---|
| Merchant setup | API key and environment (`sandbox-api.deema.me` / `api.deema.me`). Encrypted, never returned. Saving looks up a non-existent order (401 wrong key, 404 good key). The merchant enters our notification address in their Deema portal (the dashboard shows it). |
| Checkout | `POST /api/merchant/v1/purchase` with amount, `KWD`, our order id and success/failure addresses (both with `pay_return=1`). Redirect to `redirect_link`. |
| Shopper returns | The order page sees `pay_return` and asks the API, which reads the orders **it created for this order**. |
| Paid | Only `captured` / `fully_captured` with our amount and currency. |
| Notification | Only `order_ref` is taken from the body; the order details call decides. |

Not verified with real Deema: everything (see IMPLEMENTATION_PLAN.md).

## Gateway manager features → where they live

| Feature | Implementation |
|---|---|
| Enable/disable (built); ordering, display name (Phase 5) | `payment_methods` |
| Merchant credentials | Encrypted JSON validated by the adapter's schema |
| Sandbox / live | `mode` column; separate credentials per mode |
| Webhook configuration | Generated URL and (where the provider supports it) signing secret shown once |
| Test connection | `adapter.testConnection` |
| Currency / country compatibility | Adapter capabilities checked against store currency and customer country at checkout |
| Refunds | `adapter.refund` when supported, otherwise the button is absent |
| Transaction history, error logs | `payments`, `webhook_events` |
| Reconciliation | Scheduled job: `fetchStatus` for stale pending payments, plus provider settlement reports where an API exists |

## Providers

Columns: what the provider is, what Mtjari needs from each merchant, and open questions to confirm from official docs.

| Provider | Type | Typical markets | Needed from the merchant | To confirm before building |
|---|---|---|---|---|
| **Tap Payments** | Gateway/PSP | KW, SA, AE, BH, QA, OM | Tap business account, secret + publishable keys (test and live) | Current API version, webhook hash scheme, KNET/mada/Apple Pay enablement per account, marketplace vs direct |
| **MyFatoorah** (built) | Gateway/PSP | KW, SA, AE, BH, QA, OM | MyFatoorah account, API token per country portal | Real `GetPaymentStatus` response, wrong-token status code, refund API |
| **Hesabe** (built) | Gateway | KW | Merchant code, access code, secret key, IV | Paid-transaction enquiry shape, notification body, wrong-secret answer, refund API |
| **Tabby** (built) | BNPL | SA, AE, KW (confirm others) | Tabby merchant account, public + secret keys, merchant code per currency | Country/currency list, pre-scoring call, capture/close/refund flow, webhook auth header |
| **Tamara** | BNPL | SA, AE, KW (confirm others) | Tamara merchant account, API token, notification token | Order authorise/capture steps, webhook JWT verification, min/max amounts |
| **Deema** (built) | BNPL | KW (confirm others) | Deema merchant account and API key | Whether a public API is open to all merchants, webhook format, refund support |
| **Taly** | BNPL | KW (confirm others) | Taly merchant account and credentials | Whether a public API exists or integration is by agreement only |
| **mada** | Card **network** (Saudi debit) | SA | Not a gateway: enabled through a PSP/acquirer that supports it | Offered as a payment *method* of Tap / MyFatoorah / another acquirer when the merchant's account has mada enabled; requires SAR and usually a Saudi-registered business |
| **Cash on Delivery** | Offline | All | Nothing | Optional fee, max order amount, allowed zones |

Notes
- KNET (Kuwait debit) is likewise a method reached through Tap, MyFatoorah or Hesabe, not a separate adapter.
- BNPL providers approve each merchant commercially; integration can be built against sandbox but going live depends on that approval.
- Where a provider has no open API (possible for Deema/Taly), the gateway stays **Not available yet** until an agreement gives access. It will not be simulated.

## Testing strategy (Phase 5)

- Contract tests per adapter against the provider sandbox (run when sandbox credentials are present in CI secrets; skipped and reported as skipped otherwise).
- Recorded, signed webhook fixtures: valid, tampered, replayed, out-of-order, duplicated.
- Property tests on the state machine: no transition from a terminal state; total refunded ≤ captured.
- End-to-end: order → redirect to sandbox → webhook → order paid → stock decremented → appears in dashboard; and the abandoned/failed variants.
- Double-submit and concurrent-webhook tests for idempotency.

## What I need from you for Phase 5

For each provider you want first: a sandbox/test account (or an invitation to yours), and confirmation of the legal entity and country it is registered under, because that decides which currencies and methods are possible. Credentials go into the dashboard or CI secrets, never into the repository.
