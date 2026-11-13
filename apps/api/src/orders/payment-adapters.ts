import { BadGatewayException, BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomUUID } from 'node:crypto';
import { PHONE_RULES, currencyDecimals, fromMinor, toMinor } from '@mtjari/shared';
import { safeEqual } from '../common/crypto';
import { ENV, type Env } from '../config/env';

export interface CredentialField {
  key: string;
  label: { ar: string; en: string };
  /** `secret` (default) is write-only. `select` is a non-secret choice whose current value may be shown back to the merchant. */
  type?: 'secret' | 'select';
  options?: readonly { value: string; label: { ar: string; en: string } }[];
}

/** What a provider told us in a webhook, after its signature was verified. */
export interface VerifiedWebhook {
  /** The provider's unique id for this notification (used for idempotency). */
  eventId: string;
  type: string;
  /** The provider's id of the payment this is about. */
  providerRef: string;
  outcome: 'paid' | 'failed' | 'ignored';
  /** Amount and currency the provider says it collected; compared with our record before anything is marked paid. */
  amount?: number;
  currency?: string;
}

/**
 * One payment provider. Each gateway is one implementation; nothing
 * outside this interface knows provider details.
 *
 * - `offline` providers (cash on delivery) collect money outside the platform;
 *   a staff member records the payment.
 * - `online` providers are paid only through a verified webhook.
 */
export interface InitiateInput {
  orderId: string;
  orderNumber: number;
  /** Minor units (fils, halalas). */
  amount: number;
  currency: string;
  locale: 'ar' | 'en';
  storeName: string;
  customer: { name: string; phone: string; email: string | null; country: string };
  /** Where the provider sends the shopper back to (the private order page). */
  returnUrl: string;
  /** Public address of our webhook endpoint for this store and provider, or null when the API has no public address. */
  webhookUrl: string | null;
  credentials: Record<string, string>;
}

export interface PaymentAdapter {
  readonly id: string;
  readonly kind: 'offline' | 'online';
  readonly name: { ar: string; en: string };
  readonly credentialFields: readonly CredentialField[];
  /** Online only: registers the payment with the provider. */
  initiate?(input: InitiateInput): Promise<{ providerRef: string; redirectUrl: string | null }>;
  /** Online only: authenticates the notification and translates it. Throws when it cannot be trusted. */
  verifyWebhook?(input: { rawBody: Buffer; headers: Record<string, string | string[] | undefined>; credentials: Record<string, string> }): VerifiedWebhook | Promise<VerifiedWebhook>;
  /** Asks the provider, server to server, what happened to a payment. This is the source of truth. */
  fetchStatus?(input: { providerRef: string; credentials: Record<string, string> }): Promise<VerifiedWebhook>;
  /**
   * Called when a merchant saves credentials: rejects a malformed or refused key
   * (`invalid_payment_credentials`) and reports whether the key is a test or a live one.
   */
  checkCredentials?(credentials: Record<string, string>, store: { currency: string }): Promise<{ mode: 'test' | 'live' }>;
  /** Test or live, read from stored credentials without calling the provider. */
  mode?(credentials: Record<string, string>): 'test' | 'live' | null;
}

export class CashOnDeliveryAdapter implements PaymentAdapter {
  readonly id = 'cod';
  readonly kind = 'offline' as const;
  readonly name = { ar: 'الدفع عند الاستلام', en: 'Cash on delivery' };
  readonly credentialFields = [];
}

/**
 * Exists only when NODE_ENV=test. It behaves like a real online gateway
 * (secret credential, HMAC-signed webhooks) so the framework is tested end to
 * end before the first real provider arrives in Phase 5. It is never
 * registered in development or production.
 */
export class TestGatewayAdapter implements PaymentAdapter {
  readonly id = 'testpay';
  readonly kind = 'online' as const;
  readonly name = { ar: 'بوابة اختبار', en: 'Test gateway' };
  readonly credentialFields = [{ key: 'webhookSecret', label: { ar: 'مفتاح التوقيع', en: 'Webhook secret' } }];

  async initiate() {
    return { providerRef: `tp_${randomUUID()}`, redirectUrl: null };
  }

  static sign(rawBody: string | Buffer, secret: string): string {
    return createHmac('sha256', secret).update(rawBody).digest('hex');
  }

  verifyWebhook(input: { rawBody: Buffer; headers: Record<string, string | string[] | undefined>; credentials: Record<string, string> }): VerifiedWebhook {
    const signature = input.headers['x-testpay-signature'];
    const secret = input.credentials['webhookSecret'];
    if (typeof signature !== 'string' || !secret || !safeEqual(TestGatewayAdapter.sign(input.rawBody, secret), signature)) {
      throw new UnauthorizedException('invalid_signature');
    }
    const body = JSON.parse(input.rawBody.toString('utf8')) as { id?: unknown; type?: unknown; payment?: unknown; amount?: unknown; currency?: unknown };
    if (typeof body.id !== 'string' || typeof body.type !== 'string' || typeof body.payment !== 'string') throw new UnauthorizedException('invalid_payload');
    return {
      eventId: body.id.slice(0, 200), type: body.type.slice(0, 100), providerRef: body.payment,
      outcome: body.type === 'payment.paid' ? 'paid' : body.type === 'payment.failed' ? 'failed' : 'ignored',
      amount: typeof body.amount === 'number' ? body.amount : undefined,
      currency: typeof body.currency === 'string' ? body.currency : undefined,
    };
  }
}

const decimalsOf = (currency: string): number | null => { try { return currencyDecimals(currency); } catch { return null; } };

type TapCharge = {
  id?: unknown; status?: unknown; amount?: unknown; currency?: unknown;
  transaction?: { url?: unknown; created?: unknown };
  reference?: { gateway?: unknown; payment?: unknown };
  errors?: { code?: unknown; description?: unknown }[];
};

/**
 * Tap Payments (https://developers.tap.company), redirect flow:
 *  1. POST /v2/charges with `source.id = src_all` returns `transaction.url`, Tap's hosted page
 *     (KNET, cards, Apple Pay: whatever the merchant's Tap account has enabled).
 *  2. Tap sends the shopper back to `redirect.url?tap_id=chg_...` and posts the charge to `post.url`.
 *  3. In both cases we do not trust what arrived: we read the charge back from Tap with the
 *     merchant's secret key (GET /v2/charges/{id}) and only act on that answer.
 *
 * Each store uses its own Tap account: the merchant pastes their secret key
 * (`sk_test_...` or `sk_live_...`) in the dashboard. Nothing is shared between stores.
 */
export class TapAdapter implements PaymentAdapter {
  readonly id = 'tap';
  readonly kind = 'online' as const;
  readonly name = { ar: 'الدفع الإلكتروني (كي نت / بطاقة)', en: 'Online payment (KNET / card)' };
  readonly credentialFields = [{ key: 'secretKey', label: { ar: 'المفتاح السري (Secret Key)', en: 'Secret key' } }];
  private readonly logger = new Logger('Tap');
  static readonly KEY_FORMAT = /^sk_(test|live)_[A-Za-z0-9]{8,200}$/;
  static readonly CHARGE_ID = /^chg_[A-Za-z0-9]{6,100}$/;
  private static readonly FAILED = new Set(['ABANDONED', 'CANCELLED', 'FAILED', 'DECLINED', 'RESTRICTED', 'VOID', 'TIMEDOUT']);

  constructor(private readonly baseUrl: string) {}

  mode(credentials: Record<string, string>): 'test' | 'live' | null {
    const m = TapAdapter.KEY_FORMAT.exec(credentials['secretKey'] ?? '');
    return m ? (m[1] as 'test' | 'live') : null;
  }

  private async call(secretKey: string, method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: TapCharge }> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method, signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${secretKey}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      this.logger.warn(`Tap ${method} ${path.split('/').slice(0, 3).join('/')} unreachable: ${(e as Error).name}`);
      throw new BadGatewayException('payment_provider_unreachable');
    }
    let data: TapCharge = {};
    try { data = (await res.json()) as TapCharge; } catch { /* a non-JSON body is handled by the status code */ }
    return { status: res.status, data };
  }

  private key(credentials: Record<string, string>): string {
    const key = credentials['secretKey'] ?? '';
    if (!TapAdapter.KEY_FORMAT.test(key)) throw new BadRequestException('invalid_payment_credentials');
    return key;
  }

  async checkCredentials(credentials: Record<string, string>) {
    const key = this.key(credentials);
    // Any authenticated read works as a key check; Tap answers 401 for a key it does not know.
    const { status } = await this.call(key, 'POST', '/v2/charges/list', { limit: 1 });
    if (status === 401 || status === 403) throw new BadRequestException('invalid_payment_credentials');
    if (status >= 500) throw new BadGatewayException('payment_provider_unreachable');
    return { mode: this.mode(credentials)! };
  }

  async initiate(input: InitiateInput) {
    const key = this.key(input.credentials);
    const rule = PHONE_RULES[input.customer.country];
    const digits = input.customer.phone.replace(/\D/g, '');
    const phone = rule && digits.startsWith(rule.dial) ? { country_code: rule.dial, number: digits.slice(rule.dial.length) } : undefined;
    const { status, data } = await this.call(key, 'POST', '/v2/charges', {
      amount: Number(fromMinor(input.amount, input.currency)),
      currency: input.currency,
      customer_initiated: true,
      threeDSecure: true,
      description: `${input.storeName} #${input.orderNumber}`.slice(0, 200),
      reference: { transaction: input.orderId, order: String(input.orderNumber) },
      metadata: { order_id: input.orderId },
      customer: { first_name: input.customer.name.slice(0, 100), ...(input.customer.email ? { email: input.customer.email } : {}), ...(phone ? { phone } : {}) },
      source: { id: 'src_all' },
      redirect: { url: input.returnUrl },
      ...(input.webhookUrl ? { post: { url: input.webhookUrl } } : {}),
    }, { lang_code: input.locale });
    const url = data.transaction?.url;
    if (status === 401 || status === 403) throw new BadGatewayException('payment_provider_rejected_credentials');
    if (status >= 300 || typeof data.id !== 'string' || !TapAdapter.CHARGE_ID.test(data.id) || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      this.logger.warn(`Tap refused charge for order ${input.orderId}: HTTP ${status} ${JSON.stringify(data.errors ?? []).slice(0, 300)}`);
      throw new BadGatewayException('payment_provider_error');
    }
    return { providerRef: data.id, redirectUrl: url };
  }

  private translate(charge: TapCharge): VerifiedWebhook {
    if (typeof charge.id !== 'string' || typeof charge.status !== 'string') throw new BadGatewayException('payment_provider_error');
    const status = charge.status.toUpperCase();
    const decimals = typeof charge.currency === 'string' ? decimalsOf(charge.currency) : null;
    const amount = typeof charge.amount === 'number' && decimals !== null ? toMinor(charge.amount.toFixed(decimals), charge.currency as string) : null;
    return {
      // Tap has no event id; a charge reaches each status once.
      eventId: `${charge.id}:${status}`, type: `charge.${status.toLowerCase()}`, providerRef: charge.id,
      outcome: status === 'CAPTURED' ? 'paid' : TapAdapter.FAILED.has(status) ? 'failed' : 'ignored',
      amount: amount ?? undefined, currency: typeof charge.currency === 'string' ? charge.currency : undefined,
    };
  }

  async fetchStatus(input: { providerRef: string; credentials: Record<string, string> }) {
    if (!TapAdapter.CHARGE_ID.test(input.providerRef)) throw new BadRequestException('invalid_payment_reference');
    const { status, data } = await this.call(this.key(input.credentials), 'GET', `/v2/charges/${input.providerRef}`);
    if (status >= 300 || data.id !== input.providerRef) throw new BadGatewayException('payment_provider_error');
    return this.translate(data);
  }

  /** The `hashstring` Tap documents for charge notifications. */
  static hashstring(charge: TapCharge, secretKey: string): string {
    const decimals = typeof charge.currency === 'string' ? decimalsOf(charge.currency) : null;
    const amount = typeof charge.amount === 'number' && decimals !== null ? charge.amount.toFixed(decimals) : '';
    const text = `x_id${String(charge.id ?? '')}x_amount${amount}x_currency${String(charge.currency ?? '')}x_gateway_reference${String(charge.reference?.gateway ?? '')}` +
      `x_payment_reference${String(charge.reference?.payment ?? '')}x_status${String(charge.status ?? '')}x_created${String(charge.transaction?.created ?? '')}`;
    return createHmac('sha256', secretKey).update(text).digest('hex');
  }

  /**
   * A notification only tells us which charge to look at. The decision is made
   * from Tap's own answer to an authenticated request, so a forged or altered
   * notification cannot mark anything paid. The documented `hashstring` is also
   * checked and a mismatch is logged, but it is not what we rely on.
   */
  async verifyWebhook(input: { rawBody: Buffer; headers: Record<string, string | string[] | undefined>; credentials: Record<string, string> }) {
    let body: TapCharge;
    try { body = JSON.parse(input.rawBody.toString('utf8')) as TapCharge; } catch { throw new UnauthorizedException('invalid_payload'); }
    if (typeof body.id !== 'string' || !TapAdapter.CHARGE_ID.test(body.id)) throw new UnauthorizedException('invalid_payload');
    const key = this.key(input.credentials);
    const posted = input.headers['hashstring'];
    if (typeof posted !== 'string' || !safeEqual(TapAdapter.hashstring(body, key), posted.toLowerCase())) this.logger.warn(`Tap notification for ${body.id}: hashstring missing or different; using the status read from Tap`);
    return this.fetchStatus({ providerRef: body.id, credentials: input.credentials });
  }
}

type MfEnvelope = { IsSuccess?: unknown; Message?: unknown; Data?: Record<string, unknown> | null };

/**
 * MyFatoorah (https://docs.myfatoorah.com), hosted invoice flow:
 *  1. POST /v2/SendPayment (NotificationOption LNK) returns `InvoiceId` and `InvoiceURL`,
 *     MyFatoorah's page with the methods enabled on the merchant's account (KNET, cards, ...).
 *  2. MyFatoorah sends the shopper back to `CallBackUrl` / `ErrorUrl` and posts a webhook.
 *  3. Neither is trusted: the invoice is read back with POST /v2/GetPaymentStatus using the
 *     merchant's token, and only `InvoiceStatus = Paid` for our amount pays the order.
 *
 * Each merchant enters their own API token and says which MyFatoorah account it belongs to,
 * because MyFatoorah has a different API address per country and the token does not say which.
 * The invoice amount is in the account's base currency, so the store currency must be that currency.
 */
export class MyFatoorahAdapter implements PaymentAdapter {
  static readonly ACCOUNTS: Record<string, { url: string; currency: string; ar: string; en: string }> = {
    test: { url: 'https://apitest.myfatoorah.com', currency: 'KWD', ar: 'حساب تجريبي (Demo)', en: 'Test (demo) account' },
    KW: { url: 'https://api.myfatoorah.com', currency: 'KWD', ar: 'الكويت', en: 'Kuwait' },
    BH: { url: 'https://api.myfatoorah.com', currency: 'BHD', ar: 'البحرين', en: 'Bahrain' },
    OM: { url: 'https://api.myfatoorah.com', currency: 'OMR', ar: 'عُمان', en: 'Oman' },
    SA: { url: 'https://api-sa.myfatoorah.com', currency: 'SAR', ar: 'السعودية', en: 'Saudi Arabia' },
    AE: { url: 'https://api-ae.myfatoorah.com', currency: 'AED', ar: 'الإمارات', en: 'UAE' },
    QA: { url: 'https://api-qa.myfatoorah.com', currency: 'QAR', ar: 'قطر', en: 'Qatar' },
  };
  readonly id = 'myfatoorah';
  readonly kind = 'online' as const;
  readonly name = { ar: 'ماي فاتورة (كي نت / بطاقة)', en: 'MyFatoorah (KNET / card)' };
  readonly credentialFields: readonly CredentialField[] = [
    { key: 'apiToken', label: { ar: 'مفتاح الربط (API Token)', en: 'API token' } },
    {
      key: 'account', label: { ar: 'بلد حساب ماي فاتورة', en: 'MyFatoorah account country' }, type: 'select',
      options: Object.entries(MyFatoorahAdapter.ACCOUNTS).map(([value, a]) => ({ value, label: { ar: a.ar, en: a.en } })),
    },
  ];
  private readonly logger = new Logger('MyFatoorah');
  static readonly TOKEN_FORMAT = /^[A-Za-z0-9_\-.+/=]{20,2000}$/;
  static readonly INVOICE_ID = /^[0-9]{1,18}$/;

  /** `overrideUrl` replaces every country address; it is set only by the automated tests. */
  constructor(private readonly overrideUrl?: string) {}

  private account(credentials: Record<string, string>) {
    const account = MyFatoorahAdapter.ACCOUNTS[credentials['account'] ?? ''];
    const token = credentials['apiToken'] ?? '';
    if (!account || !MyFatoorahAdapter.TOKEN_FORMAT.test(token)) throw new BadRequestException('invalid_payment_credentials');
    return { token, currency: account.currency, url: this.overrideUrl ?? account.url };
  }

  mode(credentials: Record<string, string>): 'test' | 'live' | null {
    const key = credentials['account'] ?? '';
    return key in MyFatoorahAdapter.ACCOUNTS ? (key === 'test' ? 'test' : 'live') : null;
  }

  private async call(credentials: Record<string, string>, path: string, body: unknown): Promise<{ status: number; data: MfEnvelope }> {
    const { token, url } = this.account(credentials);
    let res: Response;
    try {
      res = await fetch(`${url}${path}`, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch (e) {
      this.logger.warn(`MyFatoorah ${path} unreachable: ${(e as Error).name}`);
      throw new BadGatewayException('payment_provider_unreachable');
    }
    let data: MfEnvelope = {};
    try { data = (await res.json()) as MfEnvelope; } catch { /* a non-JSON body is handled by the status code */ }
    return { status: res.status, data };
  }

  async checkCredentials(credentials: Record<string, string>, store: { currency: string }) {
    const { currency } = this.account(credentials);
    // The invoice amount is always in the account's own currency; a store selling in another currency would charge the wrong amount.
    if (currency !== store.currency) throw new BadRequestException('payment_currency_mismatch');
    // A cheap authenticated call that creates nothing: MyFatoorah answers 401 for a token it does not accept.
    const { status, data } = await this.call(credentials, '/v2/InitiatePayment', { InvoiceAmount: 1, CurrencyIso: currency });
    if (status === 401 || status === 403) throw new BadRequestException('invalid_payment_credentials');
    if (status >= 300 || data.IsSuccess !== true) throw new BadGatewayException('payment_provider_unreachable');
    return { mode: this.mode(credentials)! };
  }

  async initiate(input: InitiateInput) {
    const { currency } = this.account(input.credentials);
    if (currency !== input.currency) throw new BadGatewayException('payment_provider_error');
    const rule = PHONE_RULES[input.customer.country];
    const digits = input.customer.phone.replace(/\D/g, '');
    const phone = rule && digits.startsWith(rule.dial) ? { MobileCountryCode: `+${rule.dial}`, CustomerMobile: digits.slice(rule.dial.length) } : {};
    const { status, data } = await this.call(input.credentials, '/v2/SendPayment', {
      CustomerName: input.customer.name.slice(0, 100),
      NotificationOption: 'LNK',
      InvoiceValue: Number(fromMinor(input.amount, input.currency)),
      DisplayCurrencyIso: input.currency,
      ...phone,
      ...(input.customer.email ? { CustomerEmail: input.customer.email } : {}),
      Language: input.locale === 'ar' ? 'AR' : 'EN',
      CustomerReference: input.orderId,
      UserDefinedField: `${input.storeName} #${input.orderNumber}`.slice(0, 200),
      CallBackUrl: input.returnUrl,
      ErrorUrl: input.returnUrl,
      // MyFatoorah only calls https addresses.
      ...(input.webhookUrl?.startsWith('https://') ? { WebhookUrl: input.webhookUrl } : {}),
    });
    const id = data.Data?.['InvoiceId'];
    const url = data.Data?.['InvoiceURL'];
    if (status === 401 || status === 403) throw new BadGatewayException('payment_provider_rejected_credentials');
    if (status >= 300 || data.IsSuccess !== true || (typeof id !== 'number' && typeof id !== 'string') || !MyFatoorahAdapter.INVOICE_ID.test(String(id)) || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      this.logger.warn(`MyFatoorah refused invoice for order ${input.orderId}: HTTP ${status} ${String(data.Message ?? '').slice(0, 200)}`);
      throw new BadGatewayException('payment_provider_error');
    }
    return { providerRef: String(id), redirectUrl: url };
  }

  async fetchStatus(input: { providerRef: string; credentials: Record<string, string> }): Promise<VerifiedWebhook> {
    if (!MyFatoorahAdapter.INVOICE_ID.test(input.providerRef)) throw new BadRequestException('invalid_payment_reference');
    const { currency } = this.account(input.credentials);
    const { status, data } = await this.call(input.credentials, '/v2/GetPaymentStatus', { Key: input.providerRef, KeyType: 'InvoiceId' });
    const d = data.Data;
    if (status >= 300 || data.IsSuccess !== true || !d || String(d['InvoiceId']) !== input.providerRef || typeof d['InvoiceStatus'] !== 'string') throw new BadGatewayException('payment_provider_error');
    const invoiceStatus = d['InvoiceStatus'].toUpperCase();
    const attempts = Array.isArray(d['InvoiceTransactions']) ? (d['InvoiceTransactions'] as { TransactionStatus?: unknown }[]) : [];
    // An invoice stays "Pending" after a failed attempt (the shopper may try again on the same page).
    const allFailed = attempts.length > 0 && attempts.every((a) => ['FAILED', 'CANCELED'].includes(String(a.TransactionStatus).toUpperCase()));
    const outcome = invoiceStatus === 'PAID' ? 'paid' : invoiceStatus === 'CANCELED' || (invoiceStatus === 'PENDING' && allFailed) ? 'failed' : 'ignored';
    const decimals = decimalsOf(currency);
    const amount = typeof d['InvoiceValue'] === 'number' && decimals !== null ? toMinor(d['InvoiceValue'].toFixed(decimals), currency) : null;
    return {
      // MyFatoorah has no event id we can rely on; an invoice reaches "paid" once, and each failed attempt is counted.
      eventId: outcome === 'failed' ? `${input.providerRef}:FAILED:${attempts.length}` : `${input.providerRef}:${invoiceStatus}`,
      type: `invoice.${invoiceStatus.toLowerCase()}`, providerRef: input.providerRef, outcome,
      // "InvoiceValue" is documented as the total in the account's base currency, which is the store's currency (checked when the token is saved).
      amount: amount ?? undefined, currency,
    };
  }

  /**
   * A notification only tells us which invoice to look at (webhook v1: `Data.InvoiceId`,
   * v2: `Data.Invoice.Id`). The decision is made from GetPaymentStatus with the merchant's
   * token, so MyFatoorah's separate webhook secret is not needed and a forged notification is harmless.
   */
  async verifyWebhook(input: { rawBody: Buffer; headers: Record<string, string | string[] | undefined>; credentials: Record<string, string> }) {
    let body: { Data?: { InvoiceId?: unknown; Invoice?: { Id?: unknown } } };
    try { body = JSON.parse(input.rawBody.toString('utf8')) as typeof body; } catch { throw new UnauthorizedException('invalid_payload'); }
    const id = String(body?.Data?.Invoice?.Id ?? body?.Data?.InvoiceId ?? '');
    if (!MyFatoorahAdapter.INVOICE_ID.test(id)) throw new UnauthorizedException('invalid_payload');
    return this.fetchStatus({ providerRef: id, credentials: input.credentials });
  }
}

/** Hesabe's documented AES-256-CBC format: key = the 32-character secret, iv = the 16-character IV key, ciphertext as lowercase hex. */
export function hesabeEncrypt(text: string, secretKey: string, iv: string): string {
  const c = createCipheriv('aes-256-cbc', Buffer.from(secretKey), Buffer.from(iv));
  return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('hex');
}
/** Returns null for anything that is not valid hex ciphertext under these keys. Hesabe's own libraries pad to 32 bytes, so padding is removed by hand. */
export function hesabeDecrypt(hex: string, secretKey: string, iv: string): string | null {
  const clean = hex.trim();
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 32 !== 0) return null;
  try {
    const d = createDecipheriv('aes-256-cbc', Buffer.from(secretKey), Buffer.from(iv));
    d.setAutoPadding(false);
    const plain = Buffer.concat([d.update(Buffer.from(clean, 'hex')), d.final()]);
    const pad = plain[plain.length - 1] ?? 0;
    if (pad < 1 || pad > 32 || pad > plain.length) return null;
    return plain.subarray(0, plain.length - pad).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Hesabe (https://developer.hesabe.com), redirect ("in-direct") flow:
 *  1. The checkout request is AES-encrypted with the merchant's secret key and IV and posted to
 *     /checkout with the merchant's access code. The encrypted answer holds `token` (the
 *     transaction) and `response.data` (what the payment page needs).
 *  2. The shopper is sent to /payment?data=..., pays, and is sent back to our responseUrl or
 *     failureUrl; Hesabe may also post to webhookUrl.
 *  3. Neither is trusted: the transaction is read back with GET /api/transaction/{token} using the
 *     merchant's access code, and only `SUCCESSFUL` for our amount pays the order.
 *
 * A merchant needs four values from their Hesabe panel (merchant code, access code, secret key,
 * IV key) and chooses sandbox or production. Hesabe accepts KWD here: the stores that can use it
 * sell in KWD.
 */
export class HesabeAdapter implements PaymentAdapter {
  static readonly URLS = { sandbox: 'https://sandbox.hesabe.com', production: 'https://api.hesabe.com' } as const;
  readonly id = 'hesabe';
  readonly kind = 'online' as const;
  readonly name = { ar: 'حسابي (كي نت / بطاقة)', en: 'Hesabe (KNET / card)' };
  readonly credentialFields: readonly CredentialField[] = [
    { key: 'merchantCode', label: { ar: 'رمز التاجر (Merchant Code)', en: 'Merchant code' } },
    { key: 'accessCode', label: { ar: 'رمز الوصول (Access Code)', en: 'Access code' } },
    { key: 'secretKey', label: { ar: 'مفتاح التشفير (Secret Key)', en: 'Secret key' } },
    { key: 'ivKey', label: { ar: 'مفتاح IV', en: 'IV key' } },
    {
      key: 'environment', label: { ar: 'البيئة', en: 'Environment' }, type: 'select',
      options: [
        { value: 'sandbox', label: { ar: 'تجريبية (Sandbox)', en: 'Sandbox (testing)' } },
        { value: 'production', label: { ar: 'حقيقية (Production)', en: 'Production (real payments)' } },
      ],
    },
  ];
  private readonly logger = new Logger('Hesabe');
  static readonly TRANSACTION_TOKEN = /^[0-9]{10,40}$/;
  private static readonly FAILED = new Set(['FAILED', 'CANCELLED', 'CANCELED', 'DECLINED', 'ABANDONED', 'REJECTED', 'EXPIRED', 'TIMEOUT', 'TIMEDOUT']);

  /** `overrideUrl` replaces both addresses; it is set only by the automated tests. */
  constructor(private readonly overrideUrl?: string) {}

  private keys(credentials: Record<string, string>) {
    const c = {
      merchantCode: credentials['merchantCode'] ?? '', accessCode: credentials['accessCode'] ?? '', secretKey: credentials['secretKey'] ?? '',
      ivKey: credentials['ivKey'] ?? '', environment: credentials['environment'] ?? '',
    };
    const env = c.environment === 'sandbox' || c.environment === 'production' ? c.environment : null;
    if (!env || !/^[0-9]{3,12}$/.test(c.merchantCode) || !/^[A-Za-z0-9-]{16,64}$/.test(c.accessCode)
      || !/^[\x21-\x7e]{32}$/.test(c.secretKey) || !/^[\x21-\x7e]{16}$/.test(c.ivKey)) throw new BadRequestException('invalid_payment_credentials');
    return { ...c, url: this.overrideUrl ?? HesabeAdapter.URLS[env] };
  }

  mode(credentials: Record<string, string>): 'test' | 'live' | null {
    return credentials['environment'] === 'sandbox' ? 'test' : credentials['environment'] === 'production' ? 'live' : null;
  }

  private async http(method: 'GET' | 'POST', url: string, accessCode: string, form?: string): Promise<{ status: number; text: string }> {
    try {
      const res = await fetch(url, {
        method, signal: AbortSignal.timeout(10_000),
        headers: { accesscode: accessCode, accept: 'application/json', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        body: form,
      });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      this.logger.warn(`Hesabe ${method} ${new URL(url).pathname.split('/').slice(0, 3).join('/')} unreachable: ${(e as Error).name}`);
      throw new BadGatewayException('payment_provider_unreachable');
    }
  }

  /** Encrypts the checkout request, posts it, decrypts the answer. A refusal comes back as `ok: false`. */
  private async checkout(k: ReturnType<HesabeAdapter['keys']>, payload: Record<string, unknown>) {
    const body = new URLSearchParams({ data: hesabeEncrypt(JSON.stringify(payload), k.secretKey, k.ivKey) }).toString();
    const { status, text } = await this.http('POST', `${k.url}/checkout`, k.accessCode, body);
    if (status >= 502) throw new BadGatewayException('payment_provider_unreachable');
    const plain = status === 200 ? hesabeDecrypt(text, k.secretKey, k.ivKey) : null;
    type Answer = { status?: unknown; token?: unknown; response?: { data?: unknown } };
    const parse = (): Answer | null => {
      try { return plain ? (JSON.parse(plain) as Answer) : null; } catch { return null; /* not JSON: treated as a refusal */ }
    };
    const answer = parse();
    const token = answer?.token;
    const data = answer?.response?.data;
    const ok = answer?.status === true && typeof token === 'string' && HesabeAdapter.TRANSACTION_TOKEN.test(token) && typeof data === 'string' && /^[0-9a-zA-Z._~+/=-]{8,4000}$/.test(data);
    return { ok, status, token: ok ? (token as string) : '', data: ok ? (data as string) : '' };
  }

  /**
   * The only authenticated call that proves all four values at once is a checkout, which also
   * proves the secret key and IV (a wrong pair cannot be decrypted by Hesabe). It creates one
   * unpaid 1.000 KWD transaction in the merchant's Hesabe panel that nobody can pay.
   */
  async checkCredentials(credentials: Record<string, string>, store: { currency: string }) {
    const k = this.keys(credentials);
    if (store.currency !== 'KWD') throw new BadRequestException('payment_currency_mismatch');
    const r = await this.checkout(k, {
      merchantCode: k.merchantCode, amount: 1, paymentType: 0, currency: 'KWD', orderReferenceNumber: 'mtjari-key-check', version: '3.0',
      responseUrl: 'https://mtjari.cc/key-check', failureUrl: 'https://mtjari.cc/key-check',
    });
    if (!r.ok) throw new BadRequestException('invalid_payment_credentials');
    return { mode: this.mode(credentials)! };
  }

  async initiate(input: InitiateInput) {
    const k = this.keys(input.credentials);
    if (input.currency !== 'KWD') throw new BadGatewayException('payment_provider_error');
    const rule = PHONE_RULES[input.customer.country];
    const digits = input.customer.phone.replace(/\D/g, '');
    const mobile = rule?.dial === '965' && digits.startsWith('965') && digits.length === 11 ? digits.slice(3) : null;
    const r = await this.checkout(k, {
      merchantCode: k.merchantCode,
      amount: Number(fromMinor(input.amount, 'KWD')),
      paymentType: 0,
      currency: 'KWD',
      orderReferenceNumber: input.orderId,
      version: '3.0',
      responseUrl: input.returnUrl,
      failureUrl: input.returnUrl,
      name: input.customer.name.slice(0, 100),
      ...(mobile ? { mobile_number: mobile } : {}),
      ...(input.customer.email ? { email: input.customer.email } : {}),
      variable1: String(input.orderNumber),
      // Hesabe's examples use https webhook addresses.
      ...(input.webhookUrl?.startsWith('https://') ? { webhookUrl: input.webhookUrl } : {}),
    });
    if (r.status === 401 || r.status === 403) throw new BadGatewayException('payment_provider_rejected_credentials');
    if (!r.ok) {
      this.logger.warn(`Hesabe refused checkout for order ${input.orderId}: HTTP ${r.status}`);
      throw new BadGatewayException('payment_provider_error');
    }
    return { providerRef: r.token, redirectUrl: `${k.url}/payment?data=${encodeURIComponent(r.data)}` };
  }

  async fetchStatus(input: { providerRef: string; credentials: Record<string, string> }): Promise<VerifiedWebhook> {
    if (!HesabeAdapter.TRANSACTION_TOKEN.test(input.providerRef)) throw new BadRequestException('invalid_payment_reference');
    const k = this.keys(input.credentials);
    const { status, text } = await this.http('GET', `${k.url}/api/transaction/${input.providerRef}`, k.accessCode);
    // Hesabe answers 404 "Transaction not found" for a checkout that nobody has paid or tried to pay yet.
    if (status === 404) return { eventId: `${input.providerRef}:UNPAID`, type: 'transaction.unpaid', providerRef: input.providerRef, outcome: 'ignored' };
    let body: { status?: unknown; data?: { token?: unknown; status?: unknown; amount?: unknown } | null } = {};
    try { body = JSON.parse(text) as typeof body; } catch { /* handled below */ }
    const d = body.data;
    if (status >= 300 || body.status !== true || !d || d.token !== input.providerRef || typeof d.status !== 'string') throw new BadGatewayException('payment_provider_error');
    const state = d.status.toUpperCase();
    const outcome = state === 'SUCCESSFUL' ? 'paid' : HesabeAdapter.FAILED.has(state) ? 'failed' : 'ignored';
    const amount = typeof d.amount === 'string' || typeof d.amount === 'number' ? toMinor(String(d.amount), 'KWD') : null;
    return { eventId: `${input.providerRef}:${state}`, type: `transaction.${state.toLowerCase()}`, providerRef: input.providerRef, outcome, amount: amount ?? undefined, currency: 'KWD' };
  }

  /** The notification only names the transaction (`token`); the answer comes from Hesabe's enquiry API. */
  async verifyWebhook(input: { rawBody: Buffer; headers: Record<string, string | string[] | undefined>; credentials: Record<string, string> }) {
    let body: { token?: unknown };
    try { body = JSON.parse(input.rawBody.toString('utf8')) as typeof body; } catch { throw new UnauthorizedException('invalid_payload'); }
    const token = typeof body?.token === 'string' ? body.token : '';
    if (!HesabeAdapter.TRANSACTION_TOKEN.test(token)) throw new UnauthorizedException('invalid_payload');
    return this.fetchStatus({ providerRef: token, credentials: input.credentials });
  }
}

@Injectable()
export class PaymentRegistry {
  private readonly adapters = new Map<string, PaymentAdapter>();

  constructor(@Inject(ENV) env: Env) {
    this.add(new CashOnDeliveryAdapter());
    this.add(new TapAdapter(env.TAP_API_URL.replace(/\/+$/, '')));
    this.add(new MyFatoorahAdapter(env.MYFATOORAH_API_URL?.replace(/\/+$/, '')));
    this.add(new HesabeAdapter(env.HESABE_API_URL?.replace(/\/+$/, '')));
    if (env.NODE_ENV === 'test') this.add(new TestGatewayAdapter());
  }

  private add(a: PaymentAdapter) {
    this.adapters.set(a.id, a);
  }
  get(id: string): PaymentAdapter | undefined {
    return this.adapters.get(id);
  }
  all(): PaymentAdapter[] {
    return [...this.adapters.values()];
  }
}
