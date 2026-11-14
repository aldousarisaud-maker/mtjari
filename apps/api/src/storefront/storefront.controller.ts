import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  PERMISSIONS, cartAddSchema, isThemeId, cartUpdateSchema, checkoutSchema, type CheckoutInput, storefrontProductsQuerySchema, themeDraftSchema, themePublishSchema,
  type StorefrontProductsQuery, type ThemeDraftInput, type ThemeId,
} from '@mtjari/shared';
import { Public } from '../auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission, StoreAccessGuard, Tenant, type TenantContext } from '../tenancy/tenancy';
import { CartService } from './cart.service';
import { CheckoutService } from './checkout.service';
import { Shop, StorefrontGuard, type ShopContext } from './storefront.guard';
import { StorefrontService } from './storefront.service';
import { ThemeService } from './theme.service';

const uuid = new ParseUUIDPipe({ version: '4' });
const themeParam = (v: string): ThemeId => {
  if (!isThemeId(v)) throw new BadRequestException('unknown_theme');
  return v;
};

/**
 * Public shop API. No login: the shop is chosen by hostname and every query
 * runs inside that store's RLS context. One page view makes several calls,
 * so the per-IP limit is higher than for the dashboard API
 * (STOREFRONT_THROTTLE_LIMIT per minute, default 600).
 */
@Public()
@UseGuards(StorefrontGuard)
@Throttle({ default: { limit: () => Number(process.env.STOREFRONT_THROTTLE_LIMIT) || 600, ttl: 60_000 } })
@Controller('v1/storefront')
export class StorefrontController {
  constructor(private readonly shop: StorefrontService, private readonly cart: CartService, private readonly checkout: CheckoutService) {}

  @Get('store')
  store(@Shop() s: ShopContext) { return this.shop.store(s); }

  @Get('products')
  products(@Shop() s: ShopContext, @Query(new ZodPipe(storefrontProductsQuerySchema)) q: StorefrontProductsQuery) { return this.shop.products(s, q); }

  @Get('products/:slug')
  product(@Shop() s: ShopContext, @Param('slug') slug: string) { return this.shop.product(s, slug.slice(0, 120)); }

  @Get('sitemap')
  sitemap(@Shop() s: ShopContext) { return this.shop.sitemap(s); }

  @Get('cart')
  getCart(@Shop() s: ShopContext, @Headers('x-cart-token') token?: string) { return this.checkout.cart(s, token); }

  @Get('checkout')
  checkoutView(@Shop() s: ShopContext, @Headers('x-cart-token') token?: string) { return this.checkout.view(s, token); }

  // Placing orders is limited more tightly than browsing.
  @Throttle({ default: { limit: () => Number(process.env.CHECKOUT_THROTTLE_LIMIT) || 20, ttl: 60_000 } })
  @Post('checkout')
  placeOrder(@Shop() s: ShopContext, @Body(new ZodPipe(checkoutSchema)) body: CheckoutInput, @Meta() meta: RequestMeta, @Headers('x-cart-token') token?: string) {
    return this.checkout.place(s, token, body, meta);
  }

  @Get('orders/:token')
  order(@Shop() s: ShopContext, @Param('token') token: string) { return this.checkout.orderByToken(s, token); }

  /** The shopper is back from the payment page: ask the provider what happened. `ref` is only a hint. */
  @Throttle({ default: { limit: () => Number(process.env.CHECKOUT_THROTTLE_LIMIT) || 20, ttl: 60_000 } })
  @Post('orders/:token/sync-payment') @HttpCode(200)
  syncPayment(@Shop() s: ShopContext, @Param('token') token: string, @Query('ref') ref?: string) {
    return this.checkout.syncPayment(s, token, typeof ref === 'string' ? ref.slice(0, 120) : undefined);
  }

  @Throttle({ default: { limit: () => Number(process.env.CHECKOUT_THROTTLE_LIMIT) || 20, ttl: 60_000 } })
  @Post('orders/:token/pay') @HttpCode(200)
  pay(@Shop() s: ShopContext, @Param('token') token: string) { return this.checkout.retryPayment(s, token); }

  @Post('cart/items') @HttpCode(200)
  add(@Shop() s: ShopContext, @Body(new ZodPipe(cartAddSchema)) body: { variantId: string; quantity: number }, @Headers('x-cart-token') token?: string) {
    return this.cart.add(s, token, body);
  }

  @Patch('cart/items/:id')
  update(@Shop() s: ShopContext, @Param('id', uuid) id: string, @Body(new ZodPipe(cartUpdateSchema)) body: { quantity: number }, @Headers('x-cart-token') token?: string) {
    return this.cart.setQuantity(s, token, id, body.quantity);
  }
}

/** Merchant side: choose, customise, preview and publish a theme; open or close the storefront. */
@Controller('v1/stores/:storeId')
@UseGuards(StoreAccessGuard)
export class ThemeController {
  constructor(private readonly themes: ThemeService) {}

  @RequirePermission(PERMISSIONS.THEMES_MANAGE) @Get('theme')
  overview(@Tenant() t: TenantContext) { return this.themes.overview(t); }

  @RequirePermission(PERMISSIONS.THEMES_MANAGE) @Post('theme/draft') @HttpCode(200)
  draft(@Tenant() t: TenantContext, @Body(new ZodPipe(themeDraftSchema)) body: ThemeDraftInput, @Meta() meta: RequestMeta) { return this.themes.saveDraft(t, body, meta); }

  @RequirePermission(PERMISSIONS.THEMES_MANAGE) @Post('theme/publish') @HttpCode(200)
  publish(@Tenant() t: TenantContext, @Body(new ZodPipe(themePublishSchema)) body: { themeId: ThemeId }, @Meta() meta: RequestMeta) { return this.themes.publish(t, body.themeId, meta); }

  @RequirePermission(PERMISSIONS.THEMES_MANAGE) @Get('theme/versions/:themeId')
  versions(@Tenant() t: TenantContext, @Param('themeId') themeId: string) { return this.themes.versions(t, themeParam(themeId)); }

  @RequirePermission(PERMISSIONS.THEMES_MANAGE) @Post('theme/versions/:themeId/:versionId/restore') @HttpCode(200)
  restore(@Tenant() t: TenantContext, @Param('themeId') themeId: string, @Param('versionId', uuid) versionId: string, @Meta() meta: RequestMeta) {
    return this.themes.restoreVersion(t, themeParam(themeId), versionId, meta);
  }

  @RequirePermission(PERMISSIONS.THEMES_MANAGE) @Post('theme/preview-token') @HttpCode(200)
  preview(@Tenant() t: TenantContext, @Body(new ZodPipe(themePublishSchema)) body: { themeId: ThemeId }) { return this.themes.previewToken(t, body.themeId); }

  @RequirePermission(PERMISSIONS.STORE_UPDATE) @Post('launch') @HttpCode(200)
  launch(@Tenant() t: TenantContext, @Meta() meta: RequestMeta) { return this.themes.launch(t, meta); }

  @RequirePermission(PERMISSIONS.STORE_UPDATE) @Post('unlaunch') @HttpCode(200)
  unlaunch(@Tenant() t: TenantContext, @Meta() meta: RequestMeta) { return this.themes.unlaunch(t, meta); }
}
