import { shopApi } from '@/storefront/api';
import { JsonLd } from '@/storefront/components';
import { pageContext, type ShopParams } from '@/storefront/context';
import type { ProductList } from '@/storefront/types';

export default async function StorefrontHome({ params }: { params: ShopParams }) {
  const { host, locale } = await params;
  const pc = await pageContext(host, locale);
  const { ctx, theme } = pc;
  const s = ctx.shop.theme.settings;
  const featured = s.featuredCategoryId ? ctx.shop.categories.find((c) => c.id === s.featuredCategoryId) : undefined;
  const qs = new URLSearchParams({ limit: String(s.homeProductLimit) });
  if (featured) qs.set('category', featured.slug);
  const res = await shopApi<ProductList>(pc.host, `/products?${qs}`);
  return (
    <>
      <theme.Home ctx={ctx} products={res.ok ? res.data.items : []} heading={featured ? ctx.name(featured) : ctx.t('newArrivals')}
        moreHref={ctx.href(featured ? `/c/${featured.slug}` : '/products')} />
      <JsonLd data={{
        '@context': 'https://schema.org', '@type': 'WebSite', name: ctx.shop.name, url: `${pc.origin}/${ctx.locale}`, inLanguage: ctx.locale,
        potentialAction: { '@type': 'SearchAction', target: `${pc.origin}/${ctx.locale}/products?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
      }} />
    </>
  );
}
