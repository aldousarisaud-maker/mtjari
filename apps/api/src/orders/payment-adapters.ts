import { BadGatewayException, BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { PHONE_RULES, currencyDecimals, fromMinor, toMinor } from '@mtjari/shared';
import { safeEqual } from '../common/crypto';
import { ENV, type Env } from '../config/env';

export interface CredentialField {
  key: string;
  label: { ar: string; en: string };
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
  checkCredentials?(credentials: Record<string, string>): Promise<{ mode: 'test' | 'live' }>;
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

@Injectable()
export class PaymentRegistry {
  private readonly adapters = new Map<string, PaymentAdapter>();

  constructor(@Inject(ENV) env: Env) {
    this.add(new CashOnDeliveryAdapter());
    this.add(new TapAdapter(env.TAP_API_URL.replace(/\/+$/, '')));
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
