import 'server-only';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { API_URL } from '@/lib/session';
import type { Cart, Shop } from './types';

export const CART_COOKIE = 'mtj_cart';
export const PREVIEW_COOKIE = 'mtj_preview';

export interface ShopResult<T> { ok: boolean; status: number; data: T; code?: string }

/** Calls the public storefront API for one shop. The shop is named by host; cart and preview tokens come from httpOnly cookies. */
export async function shopApi<T>(host: string, path: string, opts: { method?: string; body?: unknown } = {}): Promise<ShopResult<T>> {
  const jar = await cookies();
  const h = await headers();
  const hdrs: Record<string, string> = { 'x-store-host': host };
  const cart = jar.get(CART_COOKIE)?.value;
  // The dashboard's embedded preview passes its token in this header (set only by the proxy); a normal preview uses the cookie.
  const preview = h.get('x-mtj-preview') || jar.get(PREVIEW_COOKIE)?.value;
  if (cart) hdrs['x-cart-token'] = cart;
  if (preview) hdrs['x-preview-token'] = preview;
  const xff = h.get('x-forwarded-for');
  if (xff) hdrs['x-forwarded-for'] = xff;
  if (opts.body !== undefined) hdrs['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/storefront${path}`, {
      method: opts.method ?? 'GET', headers: hdrs, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 503, data: null as T, code: 'generic' };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  const body = data as { message?: unknown } | null;
  return { ok: res.ok, status: res.status, data: data as T, code: res.ok ? undefined : typeof body?.message === 'string' ? body.message : 'generic' };
}

export const hostFromParam = (raw: string) => decodeURIComponent(raw).toLowerCase();

/** The shop for this request, or the 404 page when the host has no launched store. */
export const getShop = cache(async (host: string): Promise<Shop> => {
  const res = await shopApi<Shop>(host, '/store');
  if (res.status === 404) notFound();
  // A busy or unreachable API is an error, not a missing shop.
  if (!res.ok) throw new Error(`storefront API returned ${res.status}`);
  return res.data;
});

export const getCart = cache(async (host: string): Promise<Cart> => {
  const res = await shopApi<Cart>(host, '/cart');
  return res.ok ? res.data : { currency: '', items: [], itemCount: 0, subtotal: 0, checkoutAvailable: false };
});

/** Public origin of the shop, used for canonical URLs, sitemap and structured data. */
export async function shopOrigin(host: string): Promise<string> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const port = (h.get('host') ?? '').match(/:(\d+)$/)?.[1];
  return `${proto}://${host}${port && port !== '80' && port !== '443' ? `:${port}` : ''}`;
}
