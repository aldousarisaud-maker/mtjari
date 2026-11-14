import { shopApi } from '@/storefront/api';
import { JsonLd } from '@/storefront/components';
import { pageContext, type ShopParams } from '@/storefront/context';
import { Sections, type ProductsData } from '@/storefront/sections';
import type { ProductList } from '@/storefront/types';

export default async function StorefrontHome({ params }: { params: ShopParams }) {
  const { host, locale } = await params;
  const pc = await pageContext(host, locale);
  const { ctx, theme } = pc;
  const sections = ctx.shop.theme.settings.sections;

  const entries = await Promise.all(sections.flatMap((s) => {
    if (s.type !== 'products') return [];
    // A deleted category falls back to the newest products instead of leaving a hole.
    const cat = s.categoryId ? ctx.shop.categories.find((c) => c.id === s.categoryId) : undefined;
    const qs = new URLSearchParams({ limit: String(s.limit) });
    if (cat) qs.set('category', cat.slug);
    return [shopApi<ProductList>(pc.host, `/products?${qs}`).then((res): [string, ProductsData] => {
      const own = ctx.locale === 'ar' ? s.titleAr || s.titleEn : s.titleEn || s.titleAr;
      return [s.id, {
        heading: own || (cat ? ctx.name(cat) : ctx.t('newArrivals')),
        moreHref: ctx.href(cat ? `/c/${cat.slug}` : '/products'),
        products: res.ok ? res.data.items : [],
      }];
    })];
  }));

  return (
    <>
      <Sections ctx={ctx} theme={theme} sections={sections} data={Object.fromEntries(entries)} />
      <JsonLd data={{
        '@context': 'https://schema.org', '@type': 'WebSite', name: ctx.shop.name, url: `${pc.origin}/${ctx.locale}`, inLanguage: ctx.locale,
        potentialAction: { '@type': 'SearchAction', target: `${pc.origin}/${ctx.locale}/products?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
      }} />
    </>
  );
}
