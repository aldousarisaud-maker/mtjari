import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { shopApi } from '@/storefront/api';
import { JsonLd } from '@/storefront/components';
import { pageContext, seo } from '@/storefront/context';
import { ListingView, parsePage, parseSort } from '@/storefront/pages';
import type { ProductList } from '@/storefront/types';

type Params = Promise<{ host: string; locale: string; slug: string }>;

async function load(params: Params) {
  const { host, locale, slug: raw } = await params;
  const pc = await pageContext(host, locale);
  const slug = decodeURIComponent(raw);
  const category = pc.ctx.shop.categories.find((c) => c.slug === slug);
  if (!category) notFound();
  return { pc, category };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { pc, category } = await load(params);
  return seo(pc, `/c/${encodeURIComponent(category.slug)}`, { title: pc.ctx.name(category) });
}

export default async function CategoryPage({ params, searchParams }: { params: Params; searchParams: Promise<{ sort?: string; page?: string }> }) {
  const { pc, category } = await load(params);
  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const page = parsePage(sp.page);
  const qs = new URLSearchParams({ category: category.slug, sort, page: String(page), limit: '12' });
  const res = await shopApi<ProductList>(pc.host, `/products?${qs}`);
  if (!res.ok) notFound();
  const { ctx, origin } = pc;
  return (
    <>
      <ListingView pc={pc} title={ctx.name(category)} list={res.data} basePath={`/c/${category.slug}`} sort={sort}
        subcategories={ctx.shop.categories.filter((c) => c.parentId === category.id)} />
      <JsonLd data={{
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: ctx.t('home'), item: `${origin}/${ctx.locale}` },
          { '@type': 'ListItem', position: 2, name: ctx.name(category), item: `${origin}/${ctx.locale}/c/${encodeURIComponent(category.slug)}` },
        ],
      }} />
    </>
  );
}
