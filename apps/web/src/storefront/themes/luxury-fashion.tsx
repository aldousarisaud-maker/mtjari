import Link from 'next/link';
import { Search } from 'lucide-react';
import { LocaleLink } from '../client';
import { ProductImage, SearchForm, announcementText, heroText, imageAlt, priceText } from '../components';
import type { Theme } from '../theme';

/**
 * Luxury Fashion: editorial. Centred serif wordmark, thin rules, lots of
 * white space, tall 3:4 imagery without borders, square black buttons and a
 * lookbook-style home page.
 */
const serif = 'font-[family-name:var(--font-amiri)]';
const caps = 'text-xs font-medium uppercase tracking-[0.2em]';
const btn = `inline-flex h-12 items-center justify-center bg-[var(--p)] px-8 ${caps} text-[var(--on-p)] transition hover:opacity-80 disabled:opacity-40`;

export const luxuryFashion: Theme = {
  id: 'luxury-fashion',
  root: 'bg-white text-neutral-900 font-[family-name:var(--font-plex-arabic)]',
  ui: {
    container: 'mx-auto w-full max-w-6xl px-5 py-12',
    h1: `${serif} text-center text-4xl`,
    muted: 'text-sm text-neutral-500',
    grid: 'grid grid-cols-2 gap-x-5 gap-y-12 lg:grid-cols-3',
    button: btn,
    buttonGhost: `inline-flex h-11 items-center justify-center border border-neutral-900 px-6 ${caps} hover:bg-neutral-900 hover:text-white`,
    input: 'h-11 border-b border-neutral-400 bg-transparent px-1 text-sm',
    panel: 'border-y border-neutral-200 py-6',
    chip: `border-b border-transparent pb-1 ${caps} text-neutral-500 hover:border-neutral-900 hover:text-neutral-900`,
    chipActive: `border-b border-neutral-900 pb-1 ${caps}`,
    error: 'border border-red-300 px-4 py-3 text-sm text-red-700',
    success: 'border border-neutral-300 px-4 py-3 text-sm',
  },
  buy: {
    price: `${serif} text-2xl`,
    compare: 'text-sm text-neutral-400',
    label: `${caps} text-neutral-500`,
    option: 'min-w-12 border border-neutral-300 px-4 py-2.5 text-sm',
    optionActive: 'border-neutral-900 bg-neutral-900 text-white',
    optionDisabled: 'text-neutral-300 line-through',
    select: 'h-12 border border-neutral-300 bg-white px-3 text-sm',
    button: `${btn} flex-1`,
    stock: `${caps} text-neutral-500`,
    error: 'border border-red-300 px-4 py-3 text-sm text-red-700',
    success: 'border border-neutral-300 px-4 py-3 text-sm',
  },

  Layout({ ctx, children }) {
    const note = announcementText(ctx);
    return (
      <>
        {note ? <p className={`bg-[var(--p)] px-4 py-2 text-center ${caps} text-[var(--on-p)]`}>{note}</p> : null}
        <header className="border-b border-neutral-200">
          <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 py-6">
            <LocaleLink to={ctx.locale === 'ar' ? 'en' : 'ar'} className={`${caps} justify-self-start text-neutral-500 hover:text-neutral-900`}>{ctx.t('otherLanguage')}</LocaleLink>
            <Link href={ctx.href()} className={`${serif} text-center text-3xl tracking-wide sm:text-4xl`}>{ctx.shop.name}</Link>
            <Link href={ctx.href('/cart')} className={`${caps} justify-self-end hover:text-[var(--a)]`}>
              {ctx.t('cart')} (<span data-testid="cart-count">{ctx.cartCount}</span>)
            </Link>
          </div>
          <nav aria-label={ctx.t('categories')}>
            <ul className={`mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-5 pb-5 ${caps}`}>
              <li><Link href={ctx.href('/products')} className="hover:text-[var(--a)]">{ctx.t('allProducts')}</Link></li>
              {ctx.nav.map((c) => <li key={c.id}><Link href={ctx.href(`/c/${c.slug}`)} className="hover:text-[var(--a)]">{ctx.name(c)}</Link></li>)}
            </ul>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="mt-24 border-t border-neutral-200">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 py-12 text-center">
            <p className={`${serif} text-2xl`}>{ctx.shop.name}</p>
            <SearchForm ctx={ctx} className="flex w-full max-w-xs items-center border-b border-neutral-400"
              inputClass="h-10 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none" buttonClass="grid size-10 place-items-center text-neutral-500">
              <Search className="size-4" aria-hidden />
            </SearchForm>
            <p className={`${caps} text-neutral-400`}>© {new Date().getFullYear()} {ctx.shop.name} · {ctx.t('rights')}</p>
          </div>
        </footer>
      </>
    );
  },

  Home({ ctx, products, heading, moreHref }) {
    const { title, subtitle } = heroText(ctx);
    const [lead, second, ...rest] = products;
    return (
      <>
        <section className="mx-auto max-w-6xl px-5 pt-16 text-center sm:pt-24">
          {subtitle ? <p className={`${caps} text-[var(--a)]`}>{subtitle}</p> : null}
          <h1 className={`${serif} mx-auto mt-5 max-w-3xl text-5xl leading-tight sm:text-7xl`}>{title}</h1>
          <div aria-hidden className="mx-auto mt-8 h-px w-16 bg-neutral-900" />
          <Link href={ctx.href('/products')} className={`mt-8 inline-block border-b border-neutral-900 pb-1 ${caps}`}>{ctx.t('shopNow')}</Link>
        </section>
        {lead ? (
          <section aria-label={heading} className="mx-auto mt-16 grid max-w-6xl gap-5 px-5 sm:grid-cols-2">
            {[lead, second].filter((p) => !!p).map((p, i) => (
              <Link key={p.id} href={ctx.href(`/p/${p.slug}`)} className={`group relative block ${i === 1 ? 'sm:mt-24' : ''}`}>
                <ProductImage image={p.images[0]} alt={imageAlt(ctx, p.images[0], ctx.name(p))} priority sizes="(min-width:640px) 50vw, 100vw"
                  className="aspect-[3/4] w-full object-cover" fallbackClass="bg-neutral-100 text-neutral-400" />
                <span className="mt-4 flex items-baseline justify-between gap-4">
                  <span className={`${serif} text-2xl`}>{ctx.name(p)}</span>
                  <span className="text-sm text-neutral-600">{priceText(ctx, p)}</span>
                </span>
              </Link>
            ))}
          </section>
        ) : null}
        {rest.length || !lead ? (
        <section aria-labelledby="featured" className="mx-auto mt-24 max-w-6xl px-5">
          <div className="mb-10 flex items-baseline justify-between border-b border-neutral-200 pb-4">
            <h2 id="featured" className={`${serif} text-3xl`}>{heading}</h2>
            <Link href={moreHref} className={`${caps} text-neutral-500 hover:text-neutral-900`}>{ctx.t('viewAll')}</Link>
          </div>
          {rest.length ? (
            <ul className={luxuryFashion.ui.grid}>{rest.map((p) => <li key={p.id}><luxuryFashion.Card ctx={ctx} product={p} /></li>)}</ul>
          ) : <p className="text-center text-sm text-neutral-500">{ctx.t('emptyStore')}</p>}
        </section>
        ) : (
          <p className="mx-auto mt-16 max-w-6xl px-5 text-center"><Link href={moreHref} className={`${caps} text-neutral-500 hover:text-neutral-900`}>{ctx.t('viewAll')}</Link></p>
        )}
      </>
    );
  },

  Card({ ctx, product: p, priority }) {
    const name = ctx.name(p);
    return (
      <article className="group relative">
        <div className="relative overflow-hidden">
          <ProductImage image={p.images[0]} alt={imageAlt(ctx, p.images[0], name)} priority={priority} sizes="(min-width:1024px) 33vw, 50vw"
            className="aspect-[3/4] w-full object-cover transition duration-700 group-hover:scale-[1.03]" fallbackClass="bg-neutral-100 text-neutral-400" />
          {!p.inStock ? <span className={`absolute bottom-0 start-0 bg-white px-3 py-1.5 ${caps}`}>{ctx.t('outOfStock')}</span> : null}
        </div>
        <div className="mt-4 text-center">
          {p.brand ? <p className={`${caps} text-neutral-400`}>{p.brand}</p> : null}
          <h3 className={`${serif} mt-1 text-xl`}><Link href={ctx.href(`/p/${p.slug}`)} className="after:absolute after:inset-0">{name}</Link></h3>
          <p className="mt-1 text-sm text-neutral-600">
            {priceText(ctx, p)} {p.compareAtPrice ? <s className="ms-2 text-neutral-400">{ctx.money(p.compareAtPrice)}</s> : null}
          </p>
        </div>
      </article>
    );
  },

  Product({ ctx, product: p, buyBox }) {
    const name = ctx.name(p);
    const description = ctx.locale === 'ar' ? p.descriptionAr || p.descriptionEn : p.descriptionEn || p.descriptionAr;
    const images = p.images.length ? p.images : [undefined];
    return (
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <ul className={`grid gap-3 ${images.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {images.map((img, i) => (
              <li key={img?.id ?? 'none'}>
                <ProductImage image={img} alt={imageAlt(ctx, img, name)} priority={i === 0} sizes="(min-width:1024px) 30vw, 100vw"
                  className="aspect-[3/4] w-full object-cover" fallbackClass="bg-neutral-100 text-neutral-400" />
              </li>
            ))}
          </ul>
          <div className="space-y-6 lg:sticky lg:top-8 lg:self-start">
            <div>
              {p.brand ? <p className={`${caps} text-neutral-400`}>{p.brand}</p> : null}
              <h1 className={`${serif} mt-2 text-4xl leading-tight`}>{name}</h1>
            </div>
            {buyBox}
            {description ? (
              <section className="border-t border-neutral-200 pt-6">
                <h2 className={`${caps} mb-3 text-neutral-500`}>{ctx.t('description')}</h2>
                <p className="whitespace-pre-line text-sm leading-8 text-neutral-700">{description}</p>
              </section>
            ) : null}
          </div>
        </div>
        {p.related.length ? (
          <section className="mt-24">
            <h2 className={`${serif} mb-10 text-center text-3xl`}>{ctx.t('related')}</h2>
            <ul className={luxuryFashion.ui.grid}>{p.related.slice(0, 3).map((r) => <li key={r.id}><luxuryFashion.Card ctx={ctx} product={r} /></li>)}</ul>
          </section>
        ) : null}
      </div>
    );
  },
};
