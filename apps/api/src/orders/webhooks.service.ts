import { Injectable, NotFoundException } from '@nestjs/common';
import { sha256 } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentRegistry } from './payment-adapters';
import { PaymentSettlement } from './payment-settlement';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Provider notifications. Order of checks:
 *  1. the provider and store exist and the store has credentials for it,
 *  2. the adapter authenticates the notification with the store's own secret
 *     (a signature, or by reading the payment back from the provider),
 *  3. PaymentSettlement records the event once and applies it.
 */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService, private readonly registry: PaymentRegistry,
    private readonly methods: PaymentMethodsService, private readonly settlement: PaymentSettlement,
  ) {}

  async handle(provider: string, storeId: string, rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
    const adapter = this.registry.get(provider);
    if (!adapter?.verifyWebhook || !UUID_RE.test(storeId) || !rawBody?.length) throw new NotFoundException('not_found');

    const credentials = await this.prisma.tx({ storeId }, (tx) => this.methods.credentials(tx, storeId, provider));
    if (!credentials) throw new NotFoundException('not_found');
    // May call the provider, so it runs outside any database transaction.
    const event = await adapter.verifyWebhook({ rawBody, headers, credentials });
    return this.prisma.tx({ storeId }, (tx) => this.settlement.apply(tx, storeId, provider, event, sha256(rawBody.toString('utf8'))));
  }
}
