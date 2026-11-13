import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { TxClient } from '@mtjari/db';
import { CART_MAX_LINES, CART_MAX_QUANTITY } from '@mtjari/shared';
import { randomToken, sha256 } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { STORAGE, type StorageDriver } from '../storage/storage';
import type { ShopContext } from './storefront.guard';
import { variantAvailable } from './storefront.service';

const CART_TTL_MS = 30 * 24 * 3600 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * Anonymous cart. The browser only holds a random token (httpOnly cookie set
 * by the web tier); prices and availability are always read from the
 * catalogue, never from anything the client sent.
 */
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService, @Inject(STORAGE) private readonly storage: StorageDriver) {}

  private tx<T>(shop: ShopContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: shop.storeId }, fn);
  }

  private async find(tx: TxClient, shop: ShopContext, token: string | undefined) {
    if (!token || !TOKEN_RE.test(token)) return null;
    return tx.cart.findFirst({ where: { storeId: shop.storeId, tokenHash: sha256(token), expiresAt: { gt: new Date() } }, select: { id: true } });
  }

  private async present(tx: TxClient, shop: ShopContext, cartId: string | null) {
    const rows = cartId
      ? await tx.cartItem.findMany({
          where: { storeId: shop.storeId, cartId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, quantity: true,
            variant: {
              select: {
                id: true, optionValues: true, price: true, trackInventory: true, stockQuantity: true,
                product: {
                  select: {
                    slug: true, nameAr: true, nameEn: true, status: true, deletedAt: true,
                    media: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], take: 1, select: { keyBase: true, widths: true } },
                  },
                },
              },
            },
          },
        })
      : [];
    const items = rows.map((r) => {
      const v = r.variant;
      const m = v.product.media[0];
      const listed = v.product.status === 'ACTIVE' && !v.product.deletedAt;
      const issue = !listed || !variantAvailable(v) ? 'unavailable' : v.trackInventory && v.stockQuantity < r.quantity ? 'insufficient_stock' : null;
      return {
        id: r.id, variantId: v.id, slug: v.product.slug, nameAr: v.product.nameAr, nameEn: v.product.nameEn, optionValues: v.optionValues,
        image: m ? this.storage.publicUrl(`${m.keyBase}-${Math.min(...m.widths)}.webp`) : null,
        unitPrice: v.price, quantity: r.quantity, lineTotal: v.price * r.quantity,
        maxQuantity: v.trackInventory ? Math.min(v.stockQuantity, CART_MAX_QUANTITY) : CART_MAX_QUANTITY,
        issue,
      };
    });
    const ok = items.filter((i) => i.issue !== 'unavailable');
    return {
      currency: shop.store.currency,
      items,
      itemCount: ok.reduce((n, i) => n + i.quantity, 0),
      subtotal: ok.reduce((n, i) => n + i.lineTotal, 0),
    };
  }

  /** The cart inside an existing transaction, with its id (null when there is none). Used by checkout. */
  async load(tx: TxClient, shop: ShopContext, token: string | undefined) {
    const id = (await this.find(tx, shop, token))?.id ?? null;
    return { id, ...(await this.present(tx, shop, id)) };
  }

  get(shop: ShopContext, token: string | undefined) {
    return this.tx(shop, async (tx) => this.present(tx, shop, (await this.find(tx, shop, token))?.id ?? null));
  }

  async add(shop: ShopContext, token: string | undefined, input: { variantId: string; quantity: number }) {
    return this.tx(shop, async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { storeId: shop.storeId, id: input.variantId, product: { status: 'ACTIVE', deletedAt: null } },
        select: { id: true, trackInventory: true, stockQuantity: true },
      });
      if (!variant) throw new NotFoundException('product_not_found');

      let cart = await this.find(tx, shop, token);
      let newToken: string | undefined;
      if (!cart) {
        newToken = randomToken(32);
        cart = await tx.cart.create({ data: { storeId: shop.storeId, tokenHash: sha256(newToken), expiresAt: new Date(Date.now() + CART_TTL_MS) }, select: { id: true } });
      } else {
        await tx.cart.update({ where: { id: cart.id }, data: { expiresAt: new Date(Date.now() + CART_TTL_MS) } });
      }

      const line = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } }, select: { id: true, quantity: true } });
      const quantity = (line?.quantity ?? 0) + input.quantity;
      if (quantity > CART_MAX_QUANTITY) throw new BadRequestException('quantity_too_large');
      if (variant.trackInventory && variant.stockQuantity < quantity) throw new BadRequestException('insufficient_stock');
      if (line) await tx.cartItem.update({ where: { id: line.id }, data: { quantity } });
      else {
        if ((await tx.cartItem.count({ where: { cartId: cart.id } })) >= CART_MAX_LINES) throw new BadRequestException('cart_full');
        await tx.cartItem.create({ data: { storeId: shop.storeId, cartId: cart.id, variantId: variant.id, quantity } });
      }
      return { ...(newToken ? { cartToken: newToken } : {}), cart: await this.present(tx, shop, cart.id) };
    });
  }

  /** quantity 0 removes the line. */
  async setQuantity(shop: ShopContext, token: string | undefined, itemId: string, quantity: number) {
    return this.tx(shop, async (tx) => {
      const cart = await this.find(tx, shop, token);
      const line = cart
        ? await tx.cartItem.findFirst({ where: { storeId: shop.storeId, cartId: cart.id, id: itemId }, select: { id: true, variant: { select: { trackInventory: true, stockQuantity: true } } } })
        : null;
      if (!cart || !line) throw new NotFoundException('cart_item_not_found');
      if (quantity === 0) await tx.cartItem.delete({ where: { id: line.id } });
      else {
        if (line.variant.trackInventory && line.variant.stockQuantity < quantity) throw new BadRequestException('insufficient_stock');
        await tx.cartItem.update({ where: { id: line.id }, data: { quantity } });
      }
      return { cart: await this.present(tx, shop, cart.id) };
    });
  }
}
