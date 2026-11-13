import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { fromMinor } from '@mtjari/shared';
import { shopApi } from '@/storefront/api';
import { JsonLd, ThemedBuyBox } from '@/storefront/components';
import { pageContext, seo } from '@/storefront/context';
import { pickText } from '@/storefront/i18n';
import type { ProductDetail } from '@/storefront/types';

type Params = Promise<{ host: string; locale: string; slug: string }>;

const getProduct = cache(async (host: string, slug: string) => shopApi<ProductDetail>(host, `/products/${encodeURIComponent(slug)}`));

async function load(params: Params) {
  const { host, locale, slug } = await params;
  const pc = await pageContext(host, locale);
  const res = await getProduct(pc.host, decodeURIComponent(slug));
  if (!res.ok) notFound();
  return { pc, product: res.data };
}

const largest = (urls: Record<string, string>) => urls[String(Math.max(...Object.keys(urls).map(Number)))]!;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { pc, product: p } = await load(params);
  const name = pc.ctx.name(p);
  const description = (p.seoDescription || pickText(pc.ctx.locale, p.descriptionAr, p.descriptionEn) || name).replace(/\s+/g, ' ').slice(0, 170);
  const image = p.images[0] ? largest(p.images[0].urls) : undefined;
  return seo(pc, `/p/${encodeURIComponent(p.slug)}`, {
    title: p.seoTitle || name,
    description,
    openGraph: { title: p.seoTitle || name, description, type: 'website', ...(image ? { images: [{ url: image }] } : {}) },
  });
}

export default async function ProductPage({ params }: { params: Params }) {
  const { pc, product: p } = await load(params);
  const { ctx, theme, origin } = pc;
  const url = `${origin}/${ctx.locale}/p/${encodeURIComponent(p.slug)}`;
  const prices = p.variants.map((v) => v.price);
  const available = p.variants.some((v) => v.available);
  const offer = { priceCurrency: ctx.shop.currency, availability: `https://schema.org/${available ? 'InStock' : 'OutOfStock'}`, url };
  return (
    <>
      <theme.Product ctx={ctx} product={p} buyBox={<ThemedBuyBox ctx={ctx} theme={theme} product={p} />} />
      <JsonLd data={{
        '@context': 'https://schema.org', '@type': 'Product', name: ctx.name(p), url,
        description: pickText(ctx.locale, p.descriptionAr, p.descriptionEn) || undefined,
        image: p.images.map((i) => largest(i.urls)),
        sku: p.variants.length === 1 ? p.variants[0]!.sku ?? undefined : undefined,
        brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
        offers: prices.length > 1 && Math.min(...prices) !== Math.max(...prices)
          ? { '@type': 'AggregateOffer', ...offer, lowPrice: fromMinor(Math.min(...prices), ctx.shop.currency), highPrice: fromMinor(Math.max(...prices), ctx.shop.currency), offerCount: prices.length }
          : { '@type': 'Offer', ...offer, price: fromMinor(prices[0]!, ctx.shop.currency) },
      }} />
    </>
  );
}
