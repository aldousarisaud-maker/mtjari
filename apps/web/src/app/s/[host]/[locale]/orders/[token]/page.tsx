import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
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

export default async function OrderPage({ params }: { params: Params }) {
  const { host, locale, token } = await params;
  const pc = await pageContext(host, locale);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  const res = await shopApi<ShopOrder>(pc.host, `/orders/${token}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`order unavailable: ${res.status}`);
  return <OrderView pc={pc} order={res.data} />;
}
