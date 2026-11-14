import Link from 'next/link';
import type { Section } from '@mtjari/shared';
import type { Ctx, Theme } from './theme';
import type { ProductCard } from './types';

const pick = (ctx: Ctx, ar: string, en: string) => (ctx.locale === 'ar' ? ar || en : en || ar);

/** What a products section resolved to: its heading, "view all" link and items. */
export interface ProductsData { heading: string; moreHref: string; products: ProductCard[] }

/**
 * Draws the merchant's home page: the sections in their saved order, each in the theme's own style.
 * Text is rendered as text (React escapes it); nothing the merchant types becomes markup.
 */
export function Sections({ ctx, theme, sections, data }: { ctx: Ctx; theme: Theme; sections: Section[]; data: Record<string, ProductsData> }) {
  const star = Object.values(data).flatMap((d) => d.products).find((p) => p.images.length > 0);
  return (
    <div className={theme.homeWrap}>
      {sections.map((s) => {
        switch (s.type) {
          case 'hero': return <theme.Hero key={s.id} ctx={ctx} star={star} />;
          case 'categories': return <theme.Categories key={s.id} ctx={ctx} />;
          case 'products': {
            const d = data[s.id];
            return d ? <theme.Products key={s.id} ctx={ctx} id={`sec-${s.id}`} products={d.products} heading={d.heading} moreHref={d.moreHref} /> : null;
          }
          case 'banner': {
            const text = pick(ctx, s.textAr, s.textEn);
            if (!text) return null;
            return (
              <section key={s.id} aria-label={text} className="mx-auto w-full max-w-6xl px-5 py-6">
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[var(--p)] px-6 py-6 text-[var(--on-p)]">
                  <p className="text-lg font-semibold">{text}</p>
                  {s.button ? <Link href={ctx.href('/products')} className="inline-flex h-11 items-center rounded-full bg-[var(--a)] px-6 text-sm font-semibold text-[var(--on-a)]">{ctx.t('shopNow')}</Link> : null}
                </div>
              </section>
            );
          }
          case 'text': {
            const title = pick(ctx, s.titleAr, s.titleEn);
            const body = pick(ctx, s.bodyAr, s.bodyEn);
            if (!title && !body) return null;
            return (
              <section key={s.id} className="mx-auto w-full max-w-3xl px-5 py-8 text-center">
                {title ? <h2 className="text-2xl font-bold text-[var(--p)]">{title}</h2> : null}
                {body ? <p className="mt-3 whitespace-pre-line leading-8 opacity-80">{body}</p> : null}
              </section>
            );
          }
        }
      })}
    </div>
  );
}
