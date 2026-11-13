import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { Ctx, Theme } from './theme';
import { BuyBox } from './client';
import type { ProductDetail, ShopImage } from './types';

const widths = (img: ShopImage) => Object.keys(img.urls).map(Number).sort((a, b) => a - b);

/** Responsive product image; a neutral tile with the product's initial when the merchant uploaded none. */
export function ProductImage({
  image, alt, sizes, className, priority, fallbackClass = '',
}: { image: ShopImage | undefined; alt: string; sizes: string; className?: string; priority?: boolean; fallbackClass?: string }) {
  if (!image) {
    return (
      <div className={`${className ?? ''} ${fallbackClass} flex items-center justify-center`} role="img" aria-label={alt}>
        <span aria-hidden className="text-4xl font-semibold opacity-30">{alt.trim().charAt(0)}</span>
      </div>
    );
  }
  const ws = widths(image);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image.urls[ws[Math.min(1, ws.length - 1)]!]} srcSet={ws.map((w) => `${image.urls[w]} ${w}w`).join(', ')} sizes={sizes}
      width={image.width} height={image.height} alt={alt} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined} decoding="async" className={className} />
  );
}

export const imageAlt = (ctx: Ctx, img: ShopImage | undefined, fallback: string) =>
  (img ? (ctx.locale === 'ar' ? img.altAr || img.altEn : img.altEn || img.altAr) : null) || fallback;

/** "12.500 KWD" or "From 8.000 KWD" when variants differ in price. */
export function priceText(ctx: Ctx, p: { priceMin: number; priceMax: number }) {
  return p.priceMin === p.priceMax ? ctx.money(p.priceMin) : `${ctx.t('from')} ${ctx.money(p.priceMin)}`;
}

export const discountPercent = (price: number, compareAt: number | null) => (compareAt && compareAt > price ? Math.round(((compareAt - price) / compareAt) * 100) : 0);

/** The interactive part of a product page, wired to the cart. Themes only supply class names. */
export function ThemedBuyBox({ ctx, theme, product }: { ctx: Ctx; theme: Theme; product: ProductDetail }) {
  return (
    <BuyBox
      locale={ctx.locale} options={product.options} classes={theme.buy} cartHref={ctx.href('/cart')}
      labels={{ add: ctx.t('addToCart'), outOfStock: ctx.t('outOfStock'), inStock: ctx.t('inStock'), quantity: ctx.t('quantity'), viewCart: ctx.t('viewCart') }}
      variants={product.variants.map((v) => ({
        id: v.id, optionValues: v.optionValues, price: ctx.money(v.price), compare: v.compareAtPrice ? ctx.money(v.compareAtPrice) : null,
        available: v.available, maxQuantity: v.maxQuantity,
      }))}
    />
  );
}

export function Pager({ ctx, ui, page, total, limit, hrefFor }: { ctx: Ctx; ui: Theme['ui']; page: number; total: number; limit: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <nav className="mt-10 flex items-center justify-center gap-4" aria-label={ctx.t('page')}>
      {page > 1 ? <Link href={hrefFor(page - 1)} rel="prev" className={ui.buttonGhost}>{ctx.t('prev')}</Link> : null}
      <span className={ui.muted} dir="ltr">{page} / {pages}</span>
      {page < pages ? <Link href={hrefFor(page + 1)} rel="next" className={ui.buttonGhost}>{ctx.t('next')}</Link> : null}
    </nav>
  );
}

/** Black or white, whichever reads better on the given background colour. */
export function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
}

/** Merchant colours as CSS variables; themes reference them as var(--p), var(--a). */
export const themeVars = (colors: { primary: string; accent: string }) =>
  ({ '--p': colors.primary, '--a': colors.accent, '--on-p': onColor(colors.primary), '--on-a': onColor(colors.accent) }) as CSSProperties;

/** Structured data. The JSON is escaped so product text can never close the script tag. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

/** Home headline: the merchant's text, or the store name when left empty. */
export function heroText(ctx: Ctx) {
  const h = ctx.shop.theme.settings.hero;
  return {
    title: (ctx.locale === 'ar' ? h.titleAr || h.titleEn : h.titleEn || h.titleAr) || ctx.shop.name,
    subtitle: (ctx.locale === 'ar' ? h.subtitleAr || h.subtitleEn : h.subtitleEn || h.subtitleAr) || '',
  };
}

export function announcementText(ctx: Ctx) {
  const a = ctx.shop.theme.settings.announcement;
  return (ctx.locale === 'ar' ? a.ar || a.en : a.en || a.ar) || '';
}

/** Search box used by theme headers: a plain GET form, works without JavaScript. */
export function SearchForm({ ctx, className, inputClass, buttonClass, children }: { ctx: Ctx; className?: string; inputClass: string; buttonClass: string; children: React.ReactNode }) {
  return (
    <form action={ctx.href('/products')} method="get" role="search" className={className}>
      <input type="search" name="q" maxLength={80} placeholder={ctx.t('searchPlaceholder')} aria-label={ctx.t('search')} className={inputClass} />
      <button type="submit" aria-label={ctx.t('search')} className={buttonClass}>{children}</button>
    </form>
  );
}
