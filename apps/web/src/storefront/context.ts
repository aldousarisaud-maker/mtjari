import 'server-only';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { formatMoney } from '@mtjari/shared';
import { getCart, getShop, hostFromParam, shopOrigin } from './api';
import { isSfLocale, pick, st } from './i18n';
import type { Ctx, Theme } from './theme';
import { themes } from './themes';

export interface PageContext { ctx: Ctx; theme: Theme; host: string; origin: string }

/** Resolves shop, theme, language and cart for a storefront request (once per request). */
export const pageContext = cache(async (hostParam: string, localeParam: string): Promise<PageContext> => {
  if (!isSfLocale(localeParam)) notFound();
  const locale = localeParam;
  const host = hostFromParam(hostParam);
  const [shop, cart, origin] = await Promise.all([getShop(host), getCart(host), shopOrigin(host)]);
  const ctx: Ctx = {
    shop, locale, cartCount: cart.itemCount,
    t: (key) => st(locale, key),
    href: (path = '') => `/${locale}${path}`,
    money: (minor) => formatMoney(minor, shop.currency, locale),
    name: (x) => pick(locale, x),
    nav: shop.categories.filter((c) => !c.parentId),
  };
  return { ctx, theme: themes[shop.theme.id], host, origin };
});

/** Canonical URL and language alternates for a storefront page. */
export function seo(pc: PageContext, path: string, extra: Metadata = {}): Metadata {
  const url = (l: string) => `${pc.origin}/${l}${path}`;
  return {
    ...extra,
    alternates: { canonical: url(pc.ctx.locale), languages: { ar: url('ar'), en: url('en'), 'x-default': url(pc.ctx.shop.defaultLocale === 'en' ? 'en' : 'ar') } },
    // A preview must never be indexed.
    ...(pc.ctx.shop.preview ? { robots: { index: false, follow: false } } : {}),
  };
}

export type ShopParams = Promise<{ host: string; locale: string }>;
