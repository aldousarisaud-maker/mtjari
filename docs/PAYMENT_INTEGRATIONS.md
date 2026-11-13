# Mtjari.cc — Payment Integrations

Status: **framework built and tested (Phase 4); Cash on Delivery is the only working method.** No real gateway is integrated yet (Phase 5). Provider details below are from general knowledge and have **not** been re-verified against each provider's current official documentation; that verification is the first task of each provider's integration and nothing here should be treated as a guarantee of availability, fees or API shape.

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
  initiate?(input: { orderId, amount, currency, credentials }): Promise<{ providerRef: string; redirectUrl: string | null }>;
  verifyWebhook?(input: { rawBody: Buffer; headers; credentials }): VerifiedWebhook;   // throws on a bad signature
}
```

What exists around it today:
- **Credential vault**: AES-256-GCM, bound to store id and provider, write-only from the dashboard. A method with missing credentials shows **Pending configuration** and cannot be used at checkout.
- **Webhook endpoint**: `POST /v1/webhooks/payments/:provider/:storeId`. The signature is verified on the raw request body with that store's own secret; each provider event id is recorded once per store (`webhook_events`), so replays do nothing; the amount and currency must equal our payment record; only then is the order marked paid.
- **Database guard**: an order cannot become `PAID` without a `PAID` payment row of the same amount and currency.
- **Payment states**: `PENDING`, `PAID`, `FAILED`, `CANCELLED`, `REFUNDED` (refund flow itself is not built).
- **Offline methods**: staff record the payment on the order page; this is refused for online methods.
- **Test gateway (`testpay`)**: registered only when `NODE_ENV=test`, to exercise the online path in automated tests. It is not a provider and never appears in development or production.

Still to add in Phase 5, with the first real provider: `testConnection`, `fetchStatus` (server-to-server status check and reconciliation job), `refund`, sandbox/live modes, capability checks (currency/country), queue-based webhook processing, automatic cancellation of unpaid online orders, per-store ordering and display names.

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
| **MyFatoorah** | Gateway/PSP | KW, SA, AE, BH, QA, OM | MyFatoorah account, API token per country portal | Per-country base URLs, webhook signature secret, refund limits |
| **Hesabe** | Gateway | KW | Merchant code, access code, secret key, IV | Encryption scheme of requests/responses, refund API availability, supported currencies |
| **Tabby** | BNPL | SA, AE, KW (confirm others) | Tabby merchant account, public + secret keys, merchant code per currency | Country/currency list, pre-scoring call, capture/close/refund flow, webhook auth header |
| **Tamara** | BNPL | SA, AE, KW (confirm others) | Tamara merchant account, API token, notification token | Order authorise/capture steps, webhook JWT verification, min/max amounts |
| **Deema** | BNPL | KW (confirm others) | Deema merchant account and API key | Whether a public API is open to all merchants, webhook format, refund support |
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
