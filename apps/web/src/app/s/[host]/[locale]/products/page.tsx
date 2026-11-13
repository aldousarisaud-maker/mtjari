import type { Metadata } from 'next';
import { shopApi } from '@/storefront/api';
import { pageContext, seo, type ShopParams } from '@/storefront/context';
import { ListingView, parsePage, parseSort } from '@/storefront/pages';
import type { ProductList } from '@/storefront/types';

type Search = Promise<{ q?: string; sort?: string; page?: string }>;
const query = (sp: { q?: string }) => (typeof sp.q === 'string' ? sp.q.trim().slice(0, 80) : '');

export async function generateMetadata({ params, searchParams }: { params: ShopParams; searchParams: Search }): Promise<Metadata> {
  const { host, locale } = await params;
  const pc = await pageContext(host, locale);
  const q = query(await searchParams);
  // Search result pages are thin, endless variations: keep them out of the index.
  return seo(pc, '/products', { title: q ? `${pc.ctx.t('searchResults')} ${q}` : pc.ctx.t('allProducts'), ...(q ? { robots: { index: false, follow: true } } : {}) });
}

export default async function ProductsPage({ params, searchParams }: { params: ShopParams; searchParams: Search }) {
  const { host, locale } = await params;
  const sp = await searchParams;
  const pc = await pageContext(host, locale);
  const q = query(sp);
  const sort = parseSort(sp.sort);
  const page = parsePage(sp.page);
  const qs = new URLSearchParams({ sort, page: String(page), limit: '12' });
  if (q) qs.set('q', q);
  const res = await shopApi<ProductList>(pc.host, `/products?${qs}`);
  const list = res.ok ? res.data : { total: 0, page, limit: 12, items: [] };
  return <ListingView pc={pc} title={q ? `${pc.ctx.t('searchResults')} "${q}"` : pc.ctx.t('allProducts')} list={list} basePath="/products" q={q} sort={sort} />;
}
