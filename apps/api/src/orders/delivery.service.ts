import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TxClient } from '@mtjari/db';
import { KUWAIT_GOVERNORATES, type CheckoutSettingsInput, type DeliveryZoneInput } from '@mtjari/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import type { TenantContext } from '../tenancy/tenancy';

const MAX_ZONES = 100;

/** Delivery zones with their fees, and the store's checkout options. */
@Injectable()
export class DeliveryService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private tx<T>(t: TenantContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: t.storeId, userId: t.userId }, fn);
  }

  zones(t: TenantContext) {
    return this.tx(t, (tx) => tx.deliveryZone.findMany({ where: { storeId: t.storeId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }));
  }

  createZone(t: TenantContext, input: DeliveryZoneInput, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      if ((await tx.deliveryZone.count({ where: { storeId: t.storeId } })) >= MAX_ZONES) throw new ConflictException('too_many_zones');
      const zone = await tx.deliveryZone.create({ data: { storeId: t.storeId, ...input } });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'delivery_zone.created', entityType: 'delivery_zone', entityId: zone.id, metadata: { nameEn: zone.nameEn, fee: zone.fee }, meta });
      return zone;
    });
  }

  /** Adds Kuwait's six governorates as zones with one fee; governorates that already exist by name are skipped. */
  addKuwaitGovernorates(t: TenantContext, fee: number, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const existing = new Set((await tx.deliveryZone.findMany({ where: { storeId: t.storeId }, select: { nameEn: true } })).map((z) => z.nameEn));
      const missing = KUWAIT_GOVERNORATES.filter((g) => !existing.has(g.nameEn));
      if (existing.size + missing.length > MAX_ZONES) throw new ConflictException('too_many_zones');
      await tx.deliveryZone.createMany({ data: missing.map((g, i) => ({ storeId: t.storeId, nameAr: g.nameAr, nameEn: g.nameEn, fee, sortOrder: existing.size + i })) });
      if (missing.length) {
        await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'delivery_zone.kuwait_added', entityType: 'delivery_zone', metadata: { added: missing.length, fee }, meta });
      }
      return { added: missing.length };
    });
  }

  updateZone(t: TenantContext, id: string, input: DeliveryZoneInput, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const found = await tx.deliveryZone.findFirst({ where: { storeId: t.storeId, id }, select: { id: true } });
      if (!found) throw new NotFoundException('zone_not_found');
      const zone = await tx.deliveryZone.update({ where: { id }, data: input });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'delivery_zone.updated', entityType: 'delivery_zone', entityId: id, metadata: { fee: zone.fee, isActive: zone.isActive }, meta });
      return zone;
    });
  }

  deleteZone(t: TenantContext, id: string, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const { count } = await tx.deliveryZone.deleteMany({ where: { storeId: t.storeId, id } });
      if (!count) throw new NotFoundException('zone_not_found');
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'delivery_zone.deleted', entityType: 'delivery_zone', entityId: id, meta });
      return { deleted: true };
    });
  }

  settings(t: TenantContext) {
    return this.tx(t, async (tx) => {
      const s = await tx.checkoutSettings.findUnique({ where: { storeId: t.storeId } });
      return {
        pickupEnabled: s?.pickupEnabled ?? false, pickupInstructionsAr: s?.pickupInstructionsAr ?? '', pickupInstructionsEn: s?.pickupInstructionsEn ?? '',
        minOrderAmount: s?.minOrderAmount ?? 0,
      };
    });
  }

  updateSettings(t: TenantContext, input: CheckoutSettingsInput, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const data = {
        pickupEnabled: input.pickupEnabled, pickupInstructionsAr: input.pickupInstructionsAr || null, pickupInstructionsEn: input.pickupInstructionsEn || null,
        minOrderAmount: input.minOrderAmount,
      };
      await tx.checkoutSettings.upsert({ where: { storeId: t.storeId }, create: { storeId: t.storeId, ...data }, update: data });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'checkout_settings.updated', entityType: 'store', entityId: t.storeId, metadata: { pickupEnabled: input.pickupEnabled, minOrderAmount: input.minOrderAmount }, meta });
      return input;
    });
  }
}
