import Link from 'next/link';
import { Search, ShoppingCart, Zap } from 'lucide-react';
import { LocaleLink } from '../client';
import { ProductImage, SearchForm, announcementText, discountPercent, heroText, imageAlt, priceText } from '../components';
import type { Theme } from '../theme';

/**
 * Modern Electronics: information-dense. Utility bar, big search, category
 * strip, compact cards that lead with price, discount and availability,
 * and a product page built around a specification table.
 */
const btn = 'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--p)] px-5 text-sm font-bold text-[var(--on-p)] transition hover:brightness-110 disabled:opacity-50';

export const modernElectronics: Theme = {
  id: 'modern-electronics',
  root: 'bg-slate-100 text-slate-900 font-[family-name:var(--font-tajawal)]',
  ui: {
    container: 'mx-auto w-full max-w-7xl px-4 py-6',
    h1: 'text-2xl font-extrabold',
    muted: 'text-sm text-slate-500',
    grid: 'grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4',
    button: btn,
    buttonGhost: 'inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:border-[var(--p)]',
    input: 'h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm',
    panel: 'rounded-xl border border-slate-200 bg-white p-4',
    chip: 'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm hover:border-[var(--p)]',
    chipActive: 'rounded-full border border-[var(--p)] bg-[var(--p)] px-3 py-1.5 text-sm font-bold text-[var(--on-p)]',
    error: 'rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700',
    success: 'rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800',
  },
  buy: {
    price: 'text-3xl font-extrabold text-[var(--p)]',
    compare: 'text-base text-slate-400',
    label: 'text-sm font-bold text-slate-700',
    option: 'min-w-12 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium',
    optionActive: 'border-[var(--p)] ring-2 ring-[var(--p)]/30',
    optionDisabled: 'text-slate-400 line-through',
    select: 'h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm',
    button: `${btn} min-w-44 flex-1`,
    stock: 'text-sm font-medium text-emerald-700',
    error: 'rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700',
    success: 'rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800',
  },

  Layout({ ctx, children }) {
    const note = announcementText(ctx);
    return (
      <>
        <div className="bg-slate-900 text-xs text-slate-200">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2">
            <p className="truncate">{note}</p>
            <LocaleLink to={ctx.locale === 'ar' ? 'en' : 'ar'} className="shrink-0 hover:text-white">{ctx.t('otherLanguage')}</LocaleLink>
          </div>
        </div>
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
            <Link href={ctx.href()} className="flex items-center gap-2 text-xl font-extrabold">
              <span className="grid size-9 place-items-center rounded-lg bg-[var(--p)] text-[var(--on-p)]"><Zap className="size-5" aria-hidden /></span>
              {ctx.shop.name}
            </Link>
            <SearchForm ctx={ctx} className="order-3 flex w-full md:order-none md:w-auto md:flex-1"
              inputClass="h-11 min-w-0 flex-1 rounded-s-lg border border-e-0 border-slate-300 bg-slate-50 px-4 text-sm outline-none focus:border-[var(--p)]"
              buttonClass="grid h-11 w-12 place-items-center rounded-e-lg bg-[var(--p)] text-[var(--on-p)]">
              <Search className="size-5" aria-hidden />
            </SearchForm>
            <Link href={ctx.href('/cart')} className="ms-auto flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold hover:border-[var(--p)] md:ms-0">
              <ShoppingCart className="size-5" aria-hidden />{ctx.t('cart')}
              <span data-testid="cart-count" className="grid min-w-6 place-items-center rounded-full bg-[var(--a)] px-1.5 text-xs text-[var(--on-a)]">{ctx.cartCount}</span>
            </Link>
          </div>
          <nav aria-label={ctx.t('categories')} className="border-t border-slate-100 bg-white">
            <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-2 text-sm font-medium">
              <li><Link href={ctx.href('/products')} className="block whitespace-nowrap rounded-md px-3 py-1.5 hover:bg-slate-100">{ctx.t('allProducts')}</Link></li>
              {ctx.nav.map((c) => (
                <li key={c.id}><Link href={ctx.href(`/c/${c.slug}`)} className="block whitespace-nowrap rounded-md px-3 py-1.5 hover:bg-slate-100">{ctx.name(c)}</Link></li>
              ))}
            </ul>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="mt-12 bg-slate-900 text-slate-300">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-3">
            <div><p className="text-lg font-extrabold text-white">{ctx.shop.name}</p></div>
            <ul className="space-y-2 text-sm">
              <li><Link href={ctx.href('/products')} className="hover:text-white">{ctx.t('allProducts')}</Link></li>
              {ctx.nav.slice(0, 5).map((c) => <li key={c.id}><Link href={ctx.href(`/c/${c.slug}`)} className="hover:text-white">{ctx.name(c)}</Link></li>)}
            </ul>
            <p className="text-sm sm:text-end">© {new Date().getFullYear()} {ctx.shop.name}. {ctx.t('rights')}.</p>
          </div>
        </footer>
      </>
    );
  },

  homeWrap: 'mx-auto max-w-7xl space-y-8 px-4 py-6',

  Hero({ ctx }) {
    const { title, subtitle } = heroText(ctx);
    return (
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-[var(--p)] p-8 text-white sm:p-12">
        <div aria-hidden className="absolute -end-16 -top-16 size-64 rounded-full border-[28px] border-white/10" />
        <div aria-hidden className="absolute -bottom-24 end-24 size-56 rounded-full border-[20px] border-white/5" />
        <h1 className="relative max-w-xl text-3xl font-extrabold leading-tight sm:text-5xl">{title}</h1>
        {subtitle ? <p className="relative mt-4 max-w-lg text-base text-white/80 sm:text-lg">{subtitle}</p> : null}
        <Link href={ctx.href('/products')} className="relative mt-8 inline-flex h-12 items-center rounded-lg bg-[var(--a)] px-6 text-sm font-extrabold text-[var(--on-a)]">{ctx.t('shopNow')}</Link>
      </section>
    );
  },

  Categories({ ctx }) {
    if (!ctx.nav.length) return null;
    return (
      <section aria-label={ctx.t('categories')}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ctx.nav.slice(0, 6).map((c) => (
            <li key={c.id}>
              <Link href={ctx.href(`/c/${c.slug}`)} className="flex h-full min-h-20 items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 font-bold transition hover:border-[var(--p)]">
                <span>{ctx.name(c)}</span><span className="text-xs font-medium text-slate-500">{c.productCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  },

  Products({ ctx, products, heading, moreHref, id }) {
    return (
      <section aria-labelledby={id}>
        <div className="mb-4 flex items-end justify-between border-b-2 border-slate-200">
          <h2 id={id} className="-mb-0.5 border-b-2 border-[var(--p)] pb-2 text-xl font-extrabold">{heading}</h2>
          <Link href={moreHref} className="pb-2 text-sm font-bold text-[var(--p)]">{ctx.t('viewAll')}</Link>
        </div>
        {products.length ? (
          <ul className={modernElectronics.ui.grid}>
            {products.map((p, i) => <li key={p.id}><modernElectronics.Card ctx={ctx} product={p} priority={i < 4} /></li>)}
          </ul>
        ) : <p className={modernElectronics.ui.muted}>{ctx.t('emptyStore')}</p>}
      </section>
    );
  },

  Card({ ctx, product: p, priority }) {
    const name = ctx.name(p);
    const off = discountPercent(p.priceMin, p.compareAtPrice);
    return (
      <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-[var(--p)] hover:shadow-lg">
        {off ? <span className="absolute start-2 top-2 z-10 rounded-md bg-[var(--a)] px-2 py-1 text-xs font-extrabold text-[var(--on-a)]">-{off}%</span> : null}
        <ProductImage image={p.images[0]} alt={imageAlt(ctx, p.images[0], name)} priority={priority} sizes="(min-width:1024px) 25vw, 50vw"
          className="aspect-square w-full object-contain p-3" fallbackClass="bg-slate-50 text-slate-400" />
        <div className="flex flex-1 flex-col gap-2 border-t border-slate-100 p-3">
          {p.brand ? <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{p.brand}</p> : null}
          <h3 className="line-clamp-2 text-sm font-bold leading-snug">
            <Link href={ctx.href(`/p/${p.slug}`)} className="after:absolute after:inset-0">{name}</Link>
          </h3>
          <div className="mt-auto">
            <p className="text-lg font-extrabold text-[var(--p)]">{priceText(ctx, p)}</p>
            {p.compareAtPrice ? <s className="text-xs text-slate-400">{ctx.money(p.compareAtPrice)}</s> : null}
            <p className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${p.inStock ? 'text-emerald-700' : 'text-slate-500'}`}>
              <span aria-hidden className={`size-2 rounded-full ${p.inStock ? 'bg-emerald-500' : 'bg-slate-400'}`} />{p.inStock ? ctx.t('inStock') : ctx.t('outOfStock')}
            </p>
          </div>
        </div>
      </article>
    );
  },

  Product({ ctx, product: p, buyBox }) {
    const name = ctx.name(p);
    const description = ctx.locale === 'ar' ? p.descriptionAr || p.descriptionEn : p.descriptionEn || p.descriptionAr;
    const specs = [
      [ctx.t('brand'), p.brand],
      [ctx.t('sku'), p.variants.length === 1 ? p.variants[0]!.sku : null],
      [ctx.t('categories'), p.categories.map((c) => ctx.name(c)).join('، ') || null],
      ...p.options.map((o) => [o.name, o.values.join(' / ')] as const),
    ].filter((r): r is [string, string] => !!r[1]);
    return (
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <nav aria-label="breadcrumb" className="text-sm text-slate-500">
          <Link href={ctx.href()} className="hover:text-[var(--p)]">{ctx.t('home')}</Link>
          {p.categories[0] ? <> / <Link href={ctx.href(`/c/${p.categories[0].slug}`)} className="hover:text-[var(--p)]">{ctx.name(p.categories[0])}</Link></> : null}
        </nav>
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="grid gap-3 sm:grid-cols-[5rem_1fr]">
            <ul className="order-2 flex gap-2 sm:order-none sm:flex-col">
              {p.images.slice(1, 5).map((img) => (
                <li key={img.id}><ProductImage image={img} alt={imageAlt(ctx, img, name)} sizes="80px" className="size-20 rounded-lg border border-slate-200 bg-white object-contain p-1" /></li>
              ))}
            </ul>
            <ProductImage image={p.images[0]} alt={imageAlt(ctx, p.images[0], name)} priority sizes="(min-width:1024px) 45vw, 100vw"
              className="aspect-square w-full rounded-2xl border border-slate-200 bg-white object-contain p-6" fallbackClass="bg-white text-slate-400" />
          </div>
          <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
            {p.brand ? <p className="text-sm font-bold uppercase tracking-wide text-[var(--p)]">{p.brand}</p> : null}
            <h1 className="text-2xl font-extrabold leading-snug sm:text-3xl">{name}</h1>
            {buyBox}
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {description ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="mb-3 text-lg font-extrabold">{ctx.t('description')}</h2>
              <p className="whitespace-pre-line leading-8 text-slate-700">{description}</p>
            </section>
          ) : null}
          {specs.length ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="mb-3 text-lg font-extrabold">{ctx.t('details')}</h2>
              <dl className="divide-y divide-slate-100 text-sm">
                {specs.map(([k, v]) => <div key={k} className="grid grid-cols-[8rem_1fr] gap-3 py-2.5"><dt className="font-bold text-slate-500">{k}</dt><dd>{v}</dd></div>)}
              </dl>
            </section>
          ) : null}
        </div>
        {p.related.length ? (
          <section>
            <h2 className="mb-4 text-xl font-extrabold">{ctx.t('related')}</h2>
            <ul className={modernElectronics.ui.grid}>{p.related.map((r) => <li key={r.id}><modernElectronics.Card ctx={ctx} product={r} /></li>)}</ul>
          </section>
        ) : null}
      </div>
    );
  },
};
