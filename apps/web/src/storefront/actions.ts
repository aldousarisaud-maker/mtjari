'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { CART_COOKIE, shopApi } from './api';
import { isSfLocale, sfError, st } from './i18n';
import type { Cart, Locale } from './types';

export interface CartActionState { error?: string; ok?: string }

const UUID = /^[0-9a-f-]{36}$/i;
const locale = (f: FormData): Locale => {
  const v = f.get('locale')?.toString();
  return isSfLocale(v) ? v : 'ar';
};
/** The shop is always the host the shopper is on, never a form field. */
const currentHost = async () => ((await headers()).get('host') ?? '').replace(/:\d+$/, '').toLowerCase();

export async function addToCartAction(_: CartActionState, f: FormData): Promise<CartActionState> {
  const l = locale(f);
  const variantId = f.get('variantId')?.toString() ?? '';
  const quantity = Number(f.get('quantity') ?? 1);
  if (!UUID.test(variantId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return { error: sfError(l, 'generic') };
  const res = await shopApi<{ cartToken?: string; cart: Cart }>(await currentHost(), '/cart/items', { method: 'POST', body: { variantId, quantity } });
  if (!res.ok) return { error: sfError(l, res.code) };
  if (res.data.cartToken) {
    (await cookies()).set(CART_COOKIE, res.data.cartToken, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 30 * 24 * 3600,
    });
  }
  revalidatePath('/', 'layout');
  return { ok: st(l, 'added') };
}

export async function updateCartAction(_: CartActionState, f: FormData): Promise<CartActionState> {
  const l = locale(f);
  const itemId = f.get('itemId')?.toString() ?? '';
  const quantity = Number(f.get('quantity') ?? 0);
  if (!UUID.test(itemId) || !Number.isInteger(quantity) || quantity < 0 || quantity > 99) return { error: sfError(l, 'generic') };
  const res = await shopApi(await currentHost(), `/cart/items/${itemId}`, { method: 'PATCH', body: { quantity } });
  if (!res.ok) return { error: sfError(l, res.code === 'cart_item_not_found' ? 'generic' : res.code) };
  revalidatePath('/', 'layout');
  return {};
}
