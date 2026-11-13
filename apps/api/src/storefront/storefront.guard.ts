import { CanActivate, ExecutionContext, Injectable, NotFoundException, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { resolveStoreIdByHost } from '@mtjari/db';
import { isThemeId, type ThemeId } from '@mtjari/shared';
import { PrismaService } from '../common/prisma.service';
import { PreviewTokens } from './preview';

export interface ShopContext {
  storeId: string;
  host: string;
  /** Theme being previewed by a store member; null for normal shoppers. */
  previewThemeId: ThemeId | null;
  store: { id: string; name: string; slug: string; currency: string; country: string; defaultLocale: string; status: string; themeId: ThemeId | null };
}

type ShopRequest = Request & { shop?: ShopContext };

export const Shop = createParamDecorator((_: unknown, ctx: ExecutionContext): ShopContext => {
  const s = ctx.switchToHttp().getRequest<ShopRequest>().shop;
  if (!s) throw new Error('Shop used without StorefrontGuard');
  return s;
});

const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Public storefront requests name the shop by hostname (`x-store-host`, set by
 * the web tier from the request's Host). The store must be launched; a store
 * that is still a draft is only visible with a valid preview token.
 * Everything else is a plain 404, so hostnames can't be probed for state.
 */
@Injectable()
export class StorefrontGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly previews: PreviewTokens) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ShopRequest>();
    const raw = req.headers['x-store-host'];
    const host = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/:\d+$/, '') : '';
    if (!HOST_RE.test(host)) throw new NotFoundException('store_not_found');

    const storeId = await resolveStoreIdByHost(this.prisma.client, host);
    if (!storeId) throw new NotFoundException('store_not_found');
    const store = await this.prisma.tx({ storeId }, (tx) =>
      tx.store.findFirst({
        where: { id: storeId, deletedAt: null },
        select: { id: true, name: true, slug: true, currency: true, country: true, defaultLocale: true, status: true, themeId: true },
      }),
    );
    if (!store) throw new NotFoundException('store_not_found');

    const previewThemeId = this.previews.verify(req.headers['x-preview-token'], storeId);
    const live = store.status === 'ACTIVE' && isThemeId(store.themeId);
    if (!live && !previewThemeId) throw new NotFoundException('store_not_found');

    req.shop = { storeId, host, previewThemeId, store: { ...store, themeId: isThemeId(store.themeId) ? store.themeId : null } };
    return true;
  }
}
