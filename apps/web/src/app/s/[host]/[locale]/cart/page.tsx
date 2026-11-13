import type { Metadata } from 'next';
import { getCart } from '@/storefront/api';
import { pageContext, type ShopParams } from '@/storefront/context';
import { CartView } from '@/storefront/pages';

export async function generateMetadata({ params }: { params: ShopParams }): Promise<Metadata> {
  const { host, locale } = await params;
  const pc = await pageContext(host, locale);
  return { title: pc.ctx.t('cart'), robots: { index: false, follow: false } };
}

export default async function CartPage({ params }: { params: ShopParams }) {
  const { host, locale } = await params;
  const pc = await pageContext(host, locale);
  return <CartView pc={pc} cart={await getCart(pc.host)} />;
}
