import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
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
 * One payment provider. Phase 5 adds an implementation per gateway; nothing
 * outside this interface knows provider details.
 *
 * - `offline` providers (cash on delivery) collect money outside the platform;
 *   a staff member records the payment.
 * - `online` providers are paid only through a verified webhook.
 */
export interface PaymentAdapter {
  readonly id: string;
  readonly kind: 'offline' | 'online';
  readonly name: { ar: string; en: string };
  readonly credentialFields: readonly CredentialField[];
  /** Online only: registers the payment with the provider. */
  initiate?(input: { orderId: string; amount: number; currency: string; credentials: Record<string, string> }): Promise<{ providerRef: string; redirectUrl: string | null }>;
  /** Online only: checks the signature and translates the payload. Throws when the signature is wrong. */
  verifyWebhook?(input: { rawBody: Buffer; headers: Record<string, string | string[] | undefined>; credentials: Record<string, string> }): VerifiedWebhook;
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

@Injectable()
export class PaymentRegistry {
  private readonly adapters = new Map<string, PaymentAdapter>();

  constructor(@Inject(ENV) env: Env) {
    this.add(new CashOnDeliveryAdapter());
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
