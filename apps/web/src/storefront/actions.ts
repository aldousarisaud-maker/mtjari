'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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

export interface CheckoutState { error?: string }

/**
 * Places the order. Only the shopper's choices are sent; the API computes
 * prices, the delivery fee and the total itself from the cart cookie.
 */
export async function placeOrderAction(_: CheckoutState, f: FormData): Promise<CheckoutState> {
  const l = locale(f);
  const s = (k: string) => (f.get(k) ?? '').toString().trim();
  const fulfillment = s('fulfillment') === 'PICKUP' ? 'PICKUP' : 'DELIVERY';
  const body = {
    fulfillment,
    ...(fulfillment === 'DELIVERY'
      ? {
          zoneId: UUID.test(s('zoneId')) ? s('zoneId') : undefined,
          address: { area: s('area'), block: s('block'), street: s('street'), avenue: s('avenue'), building: s('building'), floor: s('floor'), apartment: s('apartment'), directions: s('directions') },
        }
      : {}),
    customer: { name: s('name'), phone: s('phone'), email: s('email') },
    note: s('note'),
    paymentProvider: s('paymentProvider'),
    locale: l,
    idempotencyKey: s('idempotencyKey'),
  };
  const res = await shopApi<{ orderNumber: number; token: string; redirectUrl: string | null }>(await currentHost(), '/checkout', { method: 'POST', body });
  if (!res.ok) {
    // Validation errors name the rule that failed (invalid_email, address_required...).
    const issue = (res.data as { issues?: { message?: string }[] } | null)?.issues?.[0]?.message;
    return { error: sfError(l, issue && /^[a-z_]+$/.test(issue) ? issue : res.code) };
  }
  (await cookies()).delete(CART_COOKIE);
  revalidatePath('/', 'layout');
  // Online payment: on to the provider's page. Otherwise show the order.
  redirect(paymentPage(res.data.redirectUrl) ?? `/${l}/orders/${res.data.token}`);
}

/**
 * A provider's payment page must be https. The only exception is the local
 * stand-in used by the browser tests, switched on explicitly.
 */
function paymentPage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('https://')) return url;
  return process.env.ALLOW_LOCAL_PAYMENT_PAGE === '1' && url.startsWith('http://127.0.0.1:') ? url : null;
}

/** "Pay now" on the order page: a new payment attempt for an unpaid online order. */
export async function payOrderAction(f: FormData): Promise<void> {
  const l = isSfLocale(f.get('locale')?.toString()) ? (f.get('locale') as 'ar' | 'en') : 'ar';
  const token = (f.get('token') ?? '').toString();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) redirect(`/${l}`);
  const res = await shopApi<{ redirectUrl: string | null }>(await currentHost(), `/orders/${token}/pay`, { method: 'POST' });
  const page = res.ok ? paymentPage(res.data.redirectUrl) : null;
  redirect(page ?? `/${l}/orders/${token}?pay_error=${res.ok ? 'payment_provider_error' : encodeURIComponent(res.code ?? 'generic')}`);
}
