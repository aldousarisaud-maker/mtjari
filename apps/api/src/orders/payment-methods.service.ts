import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { TxClient } from '@mtjari/db';
import type { PaymentMethodUpdateInput } from '@mtjari/shared';
import { AuditService } from '../audit/audit.service';
import { SecretBox } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import { ENV, type Env } from '../config/env';
import type { TenantContext } from '../tenancy/tenancy';
import { PaymentRegistry, type PaymentAdapter } from './payment-adapters';

/**
 * Which providers a store has switched on, and their credentials.
 * Credentials are encrypted with AES-256-GCM, bound to the store and provider,
 * and are never returned by any endpoint or written to logs or the audit trail.
 */
@Injectable()
export class PaymentMethodsService {
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly registry: PaymentRegistry, @Inject(ENV) env: Env,
  ) {
    this.box = new SecretBox(env.ENCRYPTION_KEYS);
  }

  private aad = (storeId: string, provider: string) => `payment:${storeId}:${provider}`;

  private decrypt(storeId: string, provider: string, enc: string | null): Record<string, string> {
    if (!enc) return {};
    return JSON.parse(this.box.decrypt(enc, this.aad(storeId, provider))) as Record<string, string>;
  }

  private configured(adapter: PaymentAdapter, creds: Record<string, string>) {
    return adapter.credentialFields.every((f) => !!creds[f.key]);
  }

  async list(t: TenantContext) {
    const rows = await this.prisma.tx({ storeId: t.storeId, userId: t.userId }, (tx) => tx.paymentMethod.findMany({ where: { storeId: t.storeId } }));
    return this.registry.all().map((a) => {
      const row = rows.find((r) => r.provider === a.id);
      const creds = this.decrypt(t.storeId, a.id, row?.credentialsEnc ?? null);
      const configured = this.configured(a, creds);
      return {
        provider: a.id, kind: a.kind, name: a.name,
        // Field names only. Stored values are never sent back.
        credentialFields: a.credentialFields.map((f) => ({
          key: f.key, label: f.label, type: f.type ?? 'secret', options: f.options ?? null,
          // Only non-secret choices are shown back.
          value: f.type === 'select' ? creds[f.key] ?? null : null,
        })),
        configured, enabled: !!row?.enabled && configured,
        // Whether the stored key is a test or a live one (online providers only); the key itself is not sent.
        mode: configured ? a.mode?.(creds) ?? null : null,
      };
    });
  }

  async update(t: TenantContext, provider: string, input: PaymentMethodUpdateInput, meta: RequestMeta) {
    const adapter = this.registry.get(provider);
    if (!adapter) throw new NotFoundException('payment_provider_not_found');
    if (input.credentials) {
      const allowed = new Set(adapter.credentialFields.map((f) => f.key));
      if (Object.keys(input.credentials).some((k) => !allowed.has(k))) throw new BadRequestException('unknown_credential_field');
    }
    const ctx = { storeId: t.storeId, userId: t.userId };
    // New credentials are checked with the provider before they are stored, so a mistyped key is caught here and not at a shopper's checkout.
    let checked: { mode: 'test' | 'live' } | null = null;
    if (input.credentials && adapter.checkCredentials) {
      const before = await this.prisma.tx(ctx, async (tx) => ({
        creds: this.decrypt(t.storeId, provider, (await tx.paymentMethod.findUnique({ where: { storeId_provider: { storeId: t.storeId, provider } } }))?.credentialsEnc ?? null),
        store: await tx.store.findUniqueOrThrow({ where: { id: t.storeId }, select: { currency: true } }),
      }));
      const merged = { ...before.creds, ...input.credentials };
      if (!this.configured(adapter, merged)) throw new BadRequestException('payment_credentials_required');
      checked = await adapter.checkCredentials(merged, before.store);
    }
    return this.prisma.tx(ctx, async (tx) => {
      const existing = await tx.paymentMethod.findUnique({ where: { storeId_provider: { storeId: t.storeId, provider } } });
      const creds = { ...this.decrypt(t.storeId, provider, existing?.credentialsEnc ?? null), ...(input.credentials ?? {}) };
      if (input.enabled && !this.configured(adapter, creds)) throw new BadRequestException('payment_credentials_required');
      const credentialsEnc = adapter.credentialFields.length ? this.box.encrypt(JSON.stringify(creds), this.aad(t.storeId, provider)) : null;
      await tx.paymentMethod.upsert({
        where: { storeId_provider: { storeId: t.storeId, provider } },
        create: { storeId: t.storeId, provider, enabled: input.enabled, credentialsEnc },
        update: { enabled: input.enabled, credentialsEnc },
      });
      await this.audit.record(tx, {
        storeId: t.storeId, actorUserId: t.userId, action: input.enabled ? 'payment_method.enabled' : 'payment_method.disabled',
        entityType: 'payment_method', entityId: provider,
        // Only the fact that credentials changed is recorded, never their content.
        metadata: { provider, credentialsChanged: !!input.credentials }, meta,
      });
      return { provider, enabled: input.enabled, configured: this.configured(adapter, creds), mode: checked?.mode ?? adapter.mode?.(creds) ?? null };
    });
  }

  /** Providers a shopper can pay with right now. */
  async usable(tx: TxClient, storeId: string): Promise<PaymentAdapter[]> {
    const rows = await tx.paymentMethod.findMany({ where: { storeId, enabled: true } });
    return this.registry.all().filter((a) => {
      const row = rows.find((r) => r.provider === a.id);
      return !!row && this.configured(a, this.decrypt(storeId, a.id, row.credentialsEnc));
    });
  }

  /** Decrypted credentials for server-side use only (initiating a payment, verifying a webhook). */
  async credentials(tx: TxClient, storeId: string, provider: string): Promise<Record<string, string> | null> {
    const row = await tx.paymentMethod.findUnique({ where: { storeId_provider: { storeId, provider } } });
    return row ? this.decrypt(storeId, provider, row.credentialsEnc) : null;
  }
}
