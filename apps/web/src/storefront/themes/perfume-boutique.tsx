import Link from 'next/link';
import { Search, ShoppingBag } from 'lucide-react';
import { LocaleLink } from '../client';
import { ProductImage, SearchForm, announcementText, heroText, imageAlt, priceText } from '../components';
import type { Theme } from '../theme';

/**
 * Perfume Boutique: dark and quiet. Near-black background, gold hairlines,
 * arch-framed bottles, a horizontally scrolling collection on the home page
 * and a centred, single-column product page.
 */
const display = 'font-[family-name:var(--font-messiri)]';
const gold = 'text-[var(--p)]';
const btn = 'inline-flex h-12 items-center justify-center rounded-full border border-[var(--p)] bg-[var(--p)] px-8 text-sm font-semibold text-[var(--on-p)] transition hover:bg-transparent hover:text-[var(--p)] disabled:opacity-40';
const Ornament = () => (
  <span aria-hidden className="flex items-center justify-center gap-3 text-[var(--p)]">
    <span className="h-px w-12 bg-current opacity-50" /><span className="size-1.5 rotate-45 bg-current" /><span className="h-px w-12 bg-current opacity-50" />
  </span>
);

export const perfumeBoutique: Theme = {
  id: 'perfume-boutique',
  root: 'bg-[#0d0a07] text-stone-200 font-[family-name:var(--font-tajawal)]',
  ui: {
    container: 'mx-auto w-full max-w-6xl px-5 py-12',
    h1: `${display} text-center text-4xl ${gold}`,
    muted: 'text-sm text-stone-400',
    grid: 'grid grid-cols-2 gap-5 lg:grid-cols-4',
    button: btn,
    buttonGhost: 'inline-flex h-11 items-center justify-center rounded-full border border-[var(--p)]/50 px-6 text-sm text-[var(--p)] hover:border-[var(--p)]',
    input: 'h-11 rounded-full border border-stone-700 bg-transparent px-4 text-sm',
    panel: 'rounded-2xl border border-[var(--p)]/25 bg-white/[0.03] p-5',
    chip: 'rounded-full border border-stone-700 px-4 py-1.5 text-sm text-stone-300 hover:border-[var(--p)]',
    chipActive: 'rounded-full border border-[var(--p)] bg-[var(--p)] px-4 py-1.5 text-sm font-semibold text-[var(--on-p)]',
    error: 'rounded-xl border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-200',
    success: 'rounded-xl border border-[var(--p)]/40 px-4 py-3 text-sm text-[var(--a)]',
  },
  buy: {
    price: `${display} text-3xl ${gold}`,
    compare: 'text-sm text-stone-500',
    label: 'text-xs tracking-widest text-stone-400',
    option: 'min-w-16 rounded-xl border border-stone-700 px-4 py-3 text-sm',
    optionActive: 'border-[var(--p)] bg-[var(--p)]/10 text-[var(--p)]',
    optionDisabled: 'text-stone-600 line-through',
    select: 'h-12 rounded-full border border-stone-700 bg-[#0d0a07] px-4 text-sm',
    button: `${btn} flex-1`,
    stock: 'text-xs tracking-widest text-stone-400',
    error: 'rounded-xl border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-200',
    success: 'rounded-xl border border-[var(--p)]/40 px-4 py-3 text-sm text-[var(--a)]',
  },

  Layout({ ctx, children }) {
    const note = announcementText(ctx);
    return (
      <>
        {note ? <p className="border-b border-[var(--p)]/20 px-4 py-2 text-center text-xs tracking-widest text-[var(--a)]">{note}</p> : null}
        <header className="border-b border-[var(--p)]/20">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5">
            <nav aria-label={ctx.t('categories')} className="hidden flex-1 md:block">
              <ul className="flex flex-wrap gap-6 text-sm text-stone-300">
                <li><Link href={ctx.href('/products')} className="hover:text-[var(--p)]">{ctx.t('allProducts')}</Link></li>
                {ctx.nav.slice(0, 4).map((c) => <li key={c.id}><Link href={ctx.href(`/c/${c.slug}`)} className="hover:text-[var(--p)]">{ctx.name(c)}</Link></li>)}
              </ul>
            </nav>
            <Link href={ctx.href()} className={`${display} text-2xl ${gold} sm:text-3xl`}>{ctx.shop.name}</Link>
            <div className="flex flex-1 items-center justify-end gap-5 text-sm">
              <LocaleLink to={ctx.locale === 'ar' ? 'en' : 'ar'} className="text-stone-400 hover:text-[var(--p)]">{ctx.t('otherLanguage')}</LocaleLink>
              <Link href={ctx.href('/cart')} aria-label={ctx.t('cart')} className="relative flex items-center gap-2 hover:text-[var(--p)]">
                <ShoppingBag className="size-5" aria-hidden />
                <span data-testid="cart-count" className="grid min-w-5 place-items-center rounded-full bg-[var(--p)] px-1 text-xs font-bold text-[var(--on-p)]">{ctx.cartCount}</span>
              </Link>
            </div>
          </div>
          <nav aria-label={ctx.t('menu')} className="border-t border-[var(--p)]/10 md:hidden">
            <ul className="flex gap-5 overflow-x-auto px-5 py-3 text-sm text-stone-300">
              <li><Link href={ctx.href('/products')} className="whitespace-nowrap">{ctx.t('allProducts')}</Link></li>
              {ctx.nav.map((c) => <li key={c.id}><Link href={ctx.href(`/c/${c.slug}`)} className="whitespace-nowrap">{ctx.name(c)}</Link></li>)}
            </ul>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="mt-24 border-t border-[var(--p)]/20">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 py-12 text-center">
            <Ornament />
            <p className={`${display} text-2xl ${gold}`}>{ctx.shop.name}</p>
            <SearchForm ctx={ctx} className="flex w-full max-w-sm items-center rounded-full border border-stone-700 ps-4"
              inputClass="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-500" buttonClass="grid size-11 place-items-center text-[var(--p)]">
              <Search className="size-4" aria-hidden />
            </SearchForm>
            <p className="text-xs text-stone-500">© {new Date().getFullYear()} {ctx.shop.name} · {ctx.t('rights')}</p>
          </div>
        </footer>
      </>
    );
  },

  Home({ ctx, products, heading, moreHref }) {
    const { title, subtitle } = heroText(ctx);
    return (
      <>
        <section className="relative overflow-hidden">
          <div aria-hidden className="absolute inset-x-0 top-0 mx-auto h-[28rem] max-w-3xl rounded-b-full bg-[radial-gradient(closest-side,var(--p),transparent)] opacity-15" />
          <div className="relative mx-auto max-w-3xl px-5 py-20 text-center sm:py-28">
            <Ornament />
            <h1 className={`${display} mt-8 text-5xl leading-tight ${gold} sm:text-7xl`}>{title}</h1>
            {subtitle ? <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-stone-300">{subtitle}</p> : null}
            <Link href={ctx.href('/products')} className="mt-10 inline-flex h-12 items-center rounded-full border border-[var(--p)] px-10 text-sm font-semibold text-[var(--p)] transition hover:bg-[var(--p)] hover:text-[var(--on-p)]">{ctx.t('shopNow')}</Link>
          </div>
        </section>
        <section aria-labelledby="featured" className="mx-auto max-w-6xl px-5">
          <div className="mb-8 flex items-end justify-between gap-4">
            <h2 id="featured" className={`${display} text-3xl ${gold}`}>{heading}</h2>
            <Link href={moreHref} className="text-sm text-stone-400 hover:text-[var(--p)]">{ctx.t('viewAll')}</Link>
          </div>
          {products.length ? (
            <ul className="-mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-6">
              {products.map((p, i) => <li key={p.id} className="w-[62%] shrink-0 snap-start sm:w-[36%] lg:w-[23.5%]"><perfumeBoutique.Card ctx={ctx} product={p} priority={i < 3} /></li>)}
            </ul>
          ) : <p className="text-center text-sm text-stone-400">{ctx.t('emptyStore')}</p>}
        </section>
        {ctx.nav.length ? (
          <section aria-label={ctx.t('categories')} className="mx-auto mt-20 max-w-6xl px-5">
            <ul className="grid gap-4 sm:grid-cols-3">
              {ctx.nav.slice(0, 3).map((c) => (
                <li key={c.id}>
                  <Link href={ctx.href(`/c/${c.slug}`)} className="block rounded-2xl border border-[var(--p)]/25 px-6 py-10 text-center transition hover:border-[var(--p)]">
                    <span className={`${display} text-2xl ${gold}`}>{ctx.name(c)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </>
    );
  },

  Card({ ctx, product: p, priority }) {
    const name = ctx.name(p);
    return (
      <article className="group relative h-full rounded-t-full border border-[var(--p)]/25 bg-white/[0.03] p-3 pb-5 text-center transition hover:border-[var(--p)]">
        <ProductImage image={p.images[0]} alt={imageAlt(ctx, p.images[0], name)} priority={priority} sizes="(min-width:1024px) 22vw, 60vw"
          className="aspect-[3/4] w-full rounded-t-full object-cover" fallbackClass="bg-stone-900 text-[var(--p)]" />
        {p.brand ? <p className="mt-4 text-xs tracking-widest text-stone-500">{p.brand}</p> : null}
        <h3 className={`${display} mt-2 text-xl`}><Link href={ctx.href(`/p/${p.slug}`)} className="after:absolute after:inset-0">{name}</Link></h3>
        <p className={`mt-2 text-sm ${gold}`}>
          {p.inStock ? priceText(ctx, p) : ctx.t('outOfStock')} {p.inStock && p.compareAtPrice ? <s className="ms-2 text-stone-500">{ctx.money(p.compareAtPrice)}</s> : null}
        </p>
      </article>
    );
  },

  Product({ ctx, product: p, buyBox }) {
    const name = ctx.name(p);
    const description = ctx.locale === 'ar' ? p.descriptionAr || p.descriptionEn : p.descriptionEn || p.descriptionAr;
    return (
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div className="mx-auto w-full max-w-md">
            <div className="rounded-t-full border border-[var(--p)]/30 p-3">
              <ProductImage image={p.images[0]} alt={imageAlt(ctx, p.images[0], name)} priority sizes="(min-width:1024px) 28rem, 100vw"
                className="aspect-[3/4] w-full rounded-t-full object-cover" fallbackClass="bg-stone-900 text-[var(--p)]" />
            </div>
            {p.images.length > 1 ? (
              <ul className="mt-4 flex justify-center gap-3">
                {p.images.slice(1, 5).map((img) => (
                  <li key={img.id}><ProductImage image={img} alt={imageAlt(ctx, img, name)} sizes="72px" className="size-18 rounded-xl border border-stone-800 object-cover" /></li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="space-y-7 text-center lg:text-start">
            {p.brand ? <p className="text-xs tracking-[0.3em] text-stone-400">{p.brand}</p> : null}
            <h1 className={`${display} text-4xl leading-tight ${gold} sm:text-5xl`}>{name}</h1>
            <div className="lg:hidden"><Ornament /></div>
            <div className="text-start">{buyBox}</div>
            {description ? (
              <section className="border-t border-[var(--p)]/20 pt-6 text-start">
                <h2 className={`${display} mb-3 text-xl ${gold}`}>{ctx.t('description')}</h2>
                <p className="whitespace-pre-line leading-8 text-stone-300">{description}</p>
              </section>
            ) : null}
          </div>
        </div>
        {p.related.length ? (
          <section className="mt-24">
            <h2 className={`${display} mb-8 text-center text-3xl ${gold}`}>{ctx.t('related')}</h2>
            <ul className={perfumeBoutique.ui.grid}>{p.related.map((r) => <li key={r.id}><perfumeBoutique.Card ctx={ctx} product={r} /></li>)}</ul>
          </section>
        ) : null}
      </div>
    );
  },
};
