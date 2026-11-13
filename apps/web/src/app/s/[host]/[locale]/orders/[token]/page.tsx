import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { shopApi } from '@/storefront/api';
import { pageContext } from '@/storefront/context';
import { OrderView } from '@/storefront/pages';
import type { ShopOrder } from '@/storefront/types';

type Params = Promise<{ host: string; locale: string; token: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { host, locale } = await params;
  const pc = await pageContext(host, locale);
  // The address holds a secret: keep it out of search engines and out of Referer headers.
  return { title: pc.ctx.t('orderReceived'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function OrderPage({ params, searchParams }: { params: Params; searchParams: Promise<{ tap_id?: string | string[]; pay_error?: string | string[] }> }) {
  const { host, locale, token } = await params;
  const q = await searchParams;
  const pc = await pageContext(host, locale);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  // Back from the payment page. The parameter is only a hint: the API asks the provider what really happened.
  if (typeof q.tap_id === 'string') {
    const ref = /^chg_[A-Za-z0-9]{6,100}$/.test(q.tap_id) ? `?ref=${q.tap_id}` : '';
    const sync = await shopApi(pc.host, `/orders/${token}/sync-payment${ref}`, { method: 'POST' });
    if (sync.status === 404) notFound();
    redirect(`/${pc.ctx.locale}/orders/${token}${sync.ok ? '' : '?pay_error=payment_status_unknown'}`);
  }
  const payError = typeof q.pay_error === 'string' && /^[a-z_]{1,60}$/.test(q.pay_error) ? q.pay_error : undefined;
  const res = await shopApi<ShopOrder>(pc.host, `/orders/${token}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`order unavailable: ${res.status}`);
  return <OrderView pc={pc} order={res.data} token={token} payError={payError} />;
}
