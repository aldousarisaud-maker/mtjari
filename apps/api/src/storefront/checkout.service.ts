import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type TxClient } from '@mtjari/db';
import { deliveryFeeFor, normalizePhone, type CheckoutInput } from '@mtjari/shared';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../catalog/inventory.service';
import { sha256 } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import { ENV, type Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { OrderTokens } from '../orders/order-tokens';
import { PaymentMethodsService } from '../orders/payment-methods.service';
import { CartService } from './cart.service';
import type { ShopContext } from './storefront.guard';

/**
 * Turns a cart into an order. Everything that decides money is read on the
 * server inside one transaction: prices and stock from the catalogue, the
 * delivery fee from the zone, the payment methods from the store's settings.
 * The client only says who the customer is and which options they chose.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger('Checkout');

  constructor(
    private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly carts: CartService,
    private readonly inventory: InventoryService, private readonly methods: PaymentMethodsService,
    private readonly tokens: OrderTokens, private readonly mail: MailService, @Inject(ENV) private readonly env: Env,
  ) {}

  private tx<T>(shop: ShopContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: shop.storeId }, fn);
  }

  private async options(tx: TxClient, shop: ShopContext) {
    const [zones, settings, methods] = await Promise.all([
      tx.deliveryZone.findMany({ where: { storeId: shop.storeId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, nameAr: true, nameEn: true, fee: true, freeAbove: true } }),
      tx.checkoutSettings.findUnique({ where: { storeId: shop.storeId } }),
      this.methods.usable(tx, shop.storeId),
    ]);
    const pickup = !!settings?.pickupEnabled;
    // Orders are only taken by a launched store, never in theme preview.
    const live = shop.store.status === 'ACTIVE';
    return {
      zones, methods,
      pickup: { enabled: pickup, instructionsAr: settings?.pickupInstructionsAr ?? null, instructionsEn: settings?.pickupInstructionsEn ?? null },
      minOrderAmount: settings?.minOrderAmount ?? 0,
      available: live && methods.length > 0 && (zones.length > 0 || pickup),
      unavailableReason: !live ? 'store_not_live' : !methods.length ? 'no_payment_method' : !zones.length && !pickup ? 'no_delivery_option' : null,
    };
  }

  /** Whether the shop can take orders at all (used to show or hide the checkout button). */
  async canCheckout(tx: TxClient, shop: ShopContext): Promise<boolean> {
    return (await this.options(tx, shop)).available;
  }

  /** The cart as the cart page shows it, including whether a checkout button should exist. */
  async cart(shop: ShopContext, cartToken: string | undefined) {
    return this.tx(shop, async (tx) => {
      const { id: _id, ...cart } = await this.carts.load(tx, shop, cartToken);
      return { ...cart, checkoutAvailable: await this.canCheckout(tx, shop) };
    });
  }

  /** Everything the checkout page shows. */
  async view(shop: ShopContext, cartToken: string | undefined) {
    return this.tx(shop, async (tx) => {
      const [cart, o] = await Promise.all([this.carts.load(tx, shop, cartToken), this.options(tx, shop)]);
      return {
        cart, zones: o.zones, pickup: o.pickup, minOrderAmount: o.minOrderAmount, country: shop.store.country,
        paymentMethods: o.methods.map((m) => ({ provider: m.id, kind: m.kind, name: m.name })),
        available: o.available, unavailableReason: o.unavailableReason,
      };
    });
  }

  private result(order: { id: string; number: number }, redirectUrl: string | null = null) {
    return { orderNumber: order.number, token: this.tokens.for(order.id).token, redirectUrl };
  }

  async place(shop: ShopContext, cartToken: string | undefined, input: CheckoutInput, meta: RequestMeta) {
    const replay = () => this.tx(shop, (tx) => tx.order.findUnique({ where: { storeId_idempotencyKey: { storeId: shop.storeId, idempotencyKey: input.idempotencyKey } }, select: { id: true, number: true } }));
    const existing = await replay();
    if (existing) return this.result(existing);

    const phone = normalizePhone(input.customer.phone, shop.store.country);
    if (!phone) throw new BadRequestException('invalid_phone');

    let placed: { order: { id: string; number: number }; redirectUrl: string | null; notify: () => Promise<void> };
    try {
      placed = await this.tx(shop, async (tx) => {
        const o = await this.options(tx, shop);
        if (!o.available) throw new ConflictException('checkout_unavailable');
        const adapter = o.methods.find((m) => m.id === input.paymentProvider);
        if (!adapter) throw new BadRequestException('payment_method_unavailable');

        const cart = await this.carts.load(tx, shop, cartToken);
        if (!cart.id || !cart.items.length) throw new ConflictException('cart_empty');
        // The shopper must see and fix a changed cart; we never silently drop or shrink lines.
        if (cart.items.some((i) => i.issue)) throw new ConflictException('cart_changed');
        if (cart.subtotal < o.minOrderAmount) throw new ConflictException('below_minimum_order');

        let deliveryFee = 0;
        let address: Prisma.InputJsonValue | undefined;
        let zoneId: string | null = null;
        if (input.fulfillment === 'DELIVERY') {
          const zone = o.zones.find((z) => z.id === input.zoneId);
          if (!zone) throw new BadRequestException('zone_unavailable');
          deliveryFee = deliveryFeeFor(zone, cart.subtotal);
          zoneId = zone.id;
          address = { ...input.address!, zoneNameAr: zone.nameAr, zoneNameEn: zone.nameEn };
        } else if (!o.pickup.enabled) throw new BadRequestException('pickup_unavailable');

        // Read the lines again with what the snapshot needs, then take stock.
        // Variants are locked in a fixed order so two checkouts cannot deadlock.
        const lines = await tx.cartItem.findMany({
          where: { storeId: shop.storeId, cartId: cart.id },
          select: { quantity: true, variant: { select: { id: true, sku: true, optionValues: true, price: true, trackInventory: true, product: { select: { id: true, nameAr: true, nameEn: true } } } } },
        });
        lines.sort((a, b) => a.variant.id.localeCompare(b.variant.id));
        const actor = { storeId: shop.storeId, userId: null };
        const number = await this.nextNumber(tx, shop.storeId);
        for (const l of lines) {
          if (l.variant.trackInventory) await this.inventory.applyInTx(tx, actor, l.variant.id, { delta: -l.quantity }, 'SALE', `order #${number}`);
        }
        const subtotal = lines.reduce((n, l) => n + l.variant.price * l.quantity, 0);
        // Defence in depth: the total we charge is the one computed here, and it must equal what the shopper was shown.
        if (subtotal !== cart.subtotal) throw new ConflictException('cart_changed');
        const total = subtotal + deliveryFee;

        const id = crypto.randomUUID();
        const order = await tx.order.create({
          data: {
            id, storeId: shop.storeId, number, paymentProvider: adapter.id, fulfillment: input.fulfillment, currency: shop.store.currency,
            subtotal, deliveryFee, total, customerName: input.customer.name, customerPhone: phone, customerEmail: input.customer.email || null,
            address, deliveryZoneId: zoneId, customerNote: input.note || null, locale: input.locale,
            accessTokenHash: this.tokens.for(id).hash, idempotencyKey: input.idempotencyKey,
            items: {
              create: lines.map((l) => ({
                productId: l.variant.product.id, variantId: l.variant.id, nameAr: l.variant.product.nameAr, nameEn: l.variant.product.nameEn,
                sku: l.variant.sku, optionValues: l.variant.optionValues as Prisma.InputJsonValue, unitPrice: l.variant.price, quantity: l.quantity,
                lineTotal: l.variant.price * l.quantity, stockTaken: l.variant.trackInventory,
              })),
            },
            events: { create: { type: 'placed', toStatus: 'PENDING' } },
          },
          select: { id: true, number: true },
        });

        let redirectUrl: string | null = null;
        let providerRef: string | null = null;
        if (adapter.kind === 'online') {
          const credentials = (await this.methods.credentials(tx, shop.storeId, adapter.id)) ?? {};
          ({ providerRef, redirectUrl } = await adapter.initiate!({ orderId: id, amount: total, currency: shop.store.currency, credentials }));
        }
        await tx.payment.create({ data: { storeId: shop.storeId, orderId: id, provider: adapter.id, amount: total, currency: shop.store.currency, providerRef } });
        await tx.cart.delete({ where: { id: cart.id } });
        await this.audit.record(tx, {
          storeId: shop.storeId, actorType: 'SYSTEM', action: 'order.placed', entityType: 'order', entityId: id,
          metadata: { number, total, fulfillment: input.fulfillment, provider: adapter.id }, meta,
        });

        const owners = await tx.membership.findMany({ where: { storeId: shop.storeId, status: 'ACTIVE', role: { key: 'owner' } }, select: { user: { select: { email: true, locale: true } } } });
        const summary = {
          storeName: shop.store.name, number, total, currency: shop.store.currency, customerName: input.customer.name,
          items: lines.map((l) => ({ nameAr: l.variant.product.nameAr, nameEn: l.variant.product.nameEn, quantity: l.quantity, lineTotal: l.variant.price * l.quantity })),
          subtotal, deliveryFee, paymentName: adapter.name,
        };
        const orderUrl = `${this.shopOrigin(shop.host)}/${input.locale}/orders/${this.tokens.for(id).token}`;
        const notify = async () => {
          if (input.customer.email) await this.mail.sendOrderConfirmation(input.customer.email, input.locale, summary, orderUrl);
          for (const o2 of owners) {
            const l = o2.user.locale === 'en' ? 'en' : 'ar';
            await this.mail.sendNewOrderNotice(o2.user.email, l, summary, `${this.env.WEB_URL}/${l}/dashboard/${shop.storeId}/orders/${id}`);
          }
        };
        return { order, redirectUrl, notify };
      });
    } catch (e) {
      // Two submits with the same key at the same moment: the loser sees a duplicate key, an emptied cart
      // or reduced stock. If the winner's order exists, that is the answer.
      const winner = await replay();
      if (winner) return this.result(winner);
      throw e;
    }

    // The order is committed. A mail problem must not turn a placed order into an error for the shopper.
    placed.notify().catch((err: Error) => this.logger.error(`order #${placed.order.number} placed but mail failed: ${err.message}`));
    return this.result(placed.order, placed.redirectUrl);
  }

  /** Per-store sequence, taken under a row lock so numbers never repeat. */
  private async nextNumber(tx: TxClient, storeId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ number: number }[]>`
      INSERT INTO checkout_settings (store_id, next_order_number, updated_at) VALUES (${storeId}::uuid, 1002, now())
      ON CONFLICT (store_id) DO UPDATE SET next_order_number = checkout_settings.next_order_number + 1, updated_at = now()
      RETURNING next_order_number - 1 AS number`;
    return rows[0]!.number;
  }

  /** Public origin of a shop host, following the scheme and port of the platform's own URL. */
  private shopOrigin(host: string): string {
    const web = new URL(this.env.WEB_URL);
    return `${web.protocol}//${host}${web.port ? `:${web.port}` : ''}`;
  }

  /** What the shopper sees after ordering. Reached only with the secret token, and only on the shop that took the order. */
  async orderByToken(shop: ShopContext, token: string) {
    if (!OrderTokens.FORMAT.test(token)) throw new NotFoundException('order_not_found');
    return this.tx(shop, async (tx) => {
      const order = await tx.order.findFirst({
        where: { storeId: shop.storeId, accessTokenHash: sha256(token) },
        select: {
          number: true, status: true, paymentStatus: true, paymentProvider: true, fulfillment: true, currency: true, subtotal: true, deliveryFee: true, total: true,
          customerName: true, customerPhone: true, address: true, customerNote: true, placedAt: true,
          items: { orderBy: { id: 'asc' }, select: { nameAr: true, nameEn: true, optionValues: true, unitPrice: true, quantity: true, lineTotal: true } },
        },
      });
      if (!order) throw new NotFoundException('order_not_found');
      const [methods, settings] = await Promise.all([this.methods.usable(tx, shop.storeId), tx.checkoutSettings.findUnique({ where: { storeId: shop.storeId } })]);
      const name = methods.find((m) => m.id === order.paymentProvider)?.name ?? { ar: order.paymentProvider, en: order.paymentProvider };
      return {
        ...order, paymentName: name,
        pickupInstructionsAr: order.fulfillment === 'PICKUP' ? settings?.pickupInstructionsAr ?? null : null,
        pickupInstructionsEn: order.fulfillment === 'PICKUP' ? settings?.pickupInstructionsEn ?? null : null,
      };
    });
  }
}
