import type { Metadata } from 'next';
import { randomBytes } from 'node:crypto';
import { shopApi } from '@/storefront/api';
import { pageContext, type ShopParams } from '@/storefront/context';
import { CheckoutView } from '@/storefront/pages';
import type { CheckoutInfo } from '@/storefront/types';

export async function generateMetadata({ params }: { params: ShopParams }): Promise<Metadata> {
  const { host, locale } = await params;
  const pc = await pageContext(host, locale);
  return { title: pc.ctx.t('checkout'), robots: { index: false, follow: false } };
}

export default async function CheckoutPage({ params }: { params: ShopParams }) {
  const { host, locale } = await params;
  const pc = await pageContext(host, locale);
  const res = await shopApi<CheckoutInfo>(pc.host, '/checkout');
  if (!res.ok) throw new Error(`checkout unavailable: ${res.status}`);
  // One key per page view: pressing the button twice, or resubmitting after a timeout, cannot create two orders.
  return <CheckoutView pc={pc} info={res.data} idempotencyKey={randomBytes(24).toString('base64url')} />;
}
