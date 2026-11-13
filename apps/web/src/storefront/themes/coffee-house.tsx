import Link from 'next/link';
import { Coffee, Search, ShoppingBasket } from 'lucide-react';
import { LocaleLink } from '../client';
import { ProductImage, SearchForm, announcementText, heroText, imageAlt, priceText } from '../components';
import type { Theme } from '../theme';

/**
 * Coffee House: warm and friendly. Cream background, floating pill header,
 * very round cards, a café-menu list on the home page (name ..... price) and
 * a product page with a big rounded photo.
 */
const btn = 'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[var(--p)] px-7 text-sm font-semibold text-[var(--on-p)] shadow-[0_6px_0_rgba(0,0,0,0.12)] transition hover:translate-y-0.5 hover:shadow-[0_3px_0_rgba(0,0,0,0.12)] disabled:opacity-50';

export const coffeeHouse: Theme = {
  id: 'coffee-house',
  root: 'bg-[#faf4ea] text-[#3b2a20] font-[family-name:var(--font-readex)]',
  ui: {
    container: 'mx-auto w-full max-w-6xl px-4 py-10',
    h1: 'text-3xl font-bold',
    muted: 'text-sm text-[#8a7566]',
    grid: 'grid grid-cols-2 gap-5 lg:grid-cols-3',
    button: btn,
    buttonGhost: 'inline-flex h-11 items-center justify-center rounded-full border-2 border-[var(--p)] px-6 text-sm font-semibold text-[var(--p)] hover:bg-[var(--p)] hover:text-[var(--on-p)]',
    input: 'h-11 rounded-full border-2 border-[#e6d9c5] bg-white px-4 text-sm',
    panel: 'rounded-[2rem] bg-white p-6 shadow-[0_10px_30px_-18px_rgba(59,42,32,0.45)]',
    chip: 'rounded-full bg-white px-4 py-2 text-sm font-medium shadow-sm hover:text-[var(--p)]',
    chipActive: 'rounded-full bg-[var(--p)] px-4 py-2 text-sm font-semibold text-[var(--on-p)]',
    error: 'rounded-2xl bg-red-100 px-4 py-3 text-sm text-red-800',
    success: 'rounded-2xl bg-[#e9f3df] px-4 py-3 text-sm text-[#35521c]',
  },
  buy: {
    price: 'text-3xl font-bold text-[var(--p)]',
    compare: 'text-base text-[#b09c8c]',
    label: 'text-sm font-semibold',
    option: 'min-w-14 rounded-full border-2 border-[#e6d9c5] bg-white px-5 py-2 text-sm font-medium',
    optionActive: 'border-[var(--p)] bg-[var(--p)] text-[var(--on-p)]',
    optionDisabled: 'text-[#c4b5a6] line-through',
    select: 'h-12 rounded-full border-2 border-[#e6d9c5] bg-white px-4 text-sm',
    button: `${btn} flex-1`,
    stock: 'text-sm font-medium text-[#5c7a3a]',
    error: 'rounded-2xl bg-red-100 px-4 py-3 text-sm text-red-800',
    success: 'rounded-2xl bg-[#e9f3df] px-4 py-3 text-sm text-[#35521c]',
  },

  Layout({ ctx, children }) {
    const note = announcementText(ctx);
    return (
      <>
        {note ? <p className="bg-[var(--a)] px-4 py-2 text-center text-sm font-medium text-[var(--on-a)]">{note}</p> : null}
        <header className="sticky top-0 z-20 px-3 pt-3">
          <div className="mx-auto flex max-w-6xl items-center gap-3 rounded-full bg-white/95 px-4 py-2.5 shadow-[0_10px_30px_-16px_rgba(59,42,32,0.5)] backdrop-blur sm:px-6">
            <Link href={ctx.href()} className="flex min-w-0 items-center gap-2 text-lg font-bold">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--p)] text-[var(--on-p)]"><Coffee className="size-5" aria-hidden /></span>
              <span className="truncate">{ctx.shop.name}</span>
            </Link>
            <nav aria-label={ctx.t('categories')} className="hidden flex-1 lg:block">
              <ul className="flex justify-center gap-1 text-sm font-medium">
                <li><Link href={ctx.href('/products')} className="rounded-full px-4 py-2 hover:bg-[#faf4ea]">{ctx.t('allProducts')}</Link></li>
                {ctx.nav.slice(0, 4).map((c) => <li key={c.id}><Link href={ctx.href(`/c/${c.slug}`)} className="rounded-full px-4 py-2 hover:bg-[#faf4ea]">{ctx.name(c)}</Link></li>)}
              </ul>
            </nav>
            <div className="ms-auto flex items-center gap-2 text-sm">
              <LocaleLink to={ctx.locale === 'ar' ? 'en' : 'ar'} className="rounded-full px-3 py-2 font-medium hover:bg-[#faf4ea]">{ctx.t('otherLanguage')}</LocaleLink>
              <Link href={ctx.href('/cart')} className="flex items-center gap-2 rounded-full bg-[#faf4ea] px-4 py-2 font-semibold hover:text-[var(--p)]">
                <ShoppingBasket className="size-5" aria-hidden /><span className="sr-only sm:not-sr-only">{ctx.t('cart')}</span>
                <span data-testid="cart-count" className="grid min-w-6 place-items-center rounded-full bg-[var(--a)] px-1.5 text-xs text-[var(--on-a)]">{ctx.cartCount}</span>
              </Link>
            </div>
          </div>
          <nav aria-label={ctx.t('menu')} className="mx-auto max-w-6xl lg:hidden">
            <ul className="flex gap-2 overflow-x-auto px-2 py-3 text-sm font-medium">
              <li><Link href={ctx.href('/products')} className="block whitespace-nowrap rounded-full bg-white px-4 py-2 shadow-sm">{ctx.t('allProducts')}</Link></li>
              {ctx.nav.map((c) => <li key={c.id}><Link href={ctx.href(`/c/${c.slug}`)} className="block whitespace-nowrap rounded-full bg-white px-4 py-2 shadow-sm">{ctx.name(c)}</Link></li>)}
            </ul>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="mt-20 rounded-t-[3rem] bg-[#3b2a20] text-[#eadfce]">
          <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 sm:grid-cols-2">
            <div>
              <p className="text-2xl font-bold text-white">{ctx.shop.name}</p>
              <SearchForm ctx={ctx} className="mt-5 flex max-w-sm items-center rounded-full bg-white/10 ps-4"
                inputClass="h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#bfae9b]" buttonClass="grid size-11 place-items-center">
                <Search className="size-4" aria-hidden />
              </SearchForm>
            </div>
            <p className="text-sm sm:self-end sm:text-end">© {new Date().getFullYear()} {ctx.shop.name}. {ctx.t('rights')}.</p>
          </div>
        </footer>
      </>
    );
  },

  Home({ ctx, products, heading, moreHref }) {
    const { title, subtitle } = heroText(ctx);
    const star = products.find((p) => p.images.length > 0);
    return (
      <div className="mx-auto max-w-6xl space-y-14 px-4 py-8">
        <section className="relative grid items-center gap-8 overflow-hidden rounded-[3rem] bg-[var(--p)] p-8 text-[var(--on-p)] sm:p-14 md:grid-cols-[1.3fr_1fr]">
          <div>
            <h1 className="text-4xl font-bold leading-tight sm:text-6xl">{title}</h1>
            {subtitle ? <p className="mt-5 max-w-md text-lg opacity-85">{subtitle}</p> : null}
            <Link href={ctx.href('/products')} className="mt-8 inline-flex h-12 items-center rounded-full bg-[var(--a)] px-8 text-sm font-semibold text-[var(--on-a)] shadow-[0_6px_0_rgba(0,0,0,0.18)]">{ctx.t('shopNow')}</Link>
          </div>
          <div className={`relative mx-auto aspect-square w-56 sm:w-72 ${star ? '' : 'hidden md:block'}`}>
            <div aria-hidden className="absolute inset-0 rounded-full bg-white/10" />
            <div aria-hidden className="absolute -inset-4 rounded-full border-2 border-dashed border-white/25" />
            {star ? (
              <ProductImage image={star.images[0]} alt={imageAlt(ctx, star.images[0], ctx.name(star))} priority sizes="18rem"
                className="relative size-full rounded-full object-cover" fallbackClass="relative size-full rounded-full bg-white/10" />
            ) : null}
          </div>
        </section>

        <section aria-labelledby="menu" className={coffeeHouse.ui.panel}>
          <div className="mb-6 flex items-end justify-between gap-4">
            <h2 id="menu" className="text-2xl font-bold">{heading}</h2>
            <Link href={moreHref} className="text-sm font-semibold text-[var(--p)]">{ctx.t('viewAll')}</Link>
          </div>
          {products.length ? (
            <ul className="grid gap-x-12 md:grid-cols-2">
              {products.slice(0, 8).map((p) => (
                <li key={p.id} className="relative flex items-center gap-4 border-b border-dashed border-[#e6d9c5] py-4">
                  <ProductImage image={p.images[0]} alt={imageAlt(ctx, p.images[0], ctx.name(p))} sizes="64px"
                    className="size-16 shrink-0 rounded-full object-cover" fallbackClass="size-16 shrink-0 rounded-full bg-[#faf4ea] text-[var(--p)]" />
                  <h3 className="min-w-0 font-semibold"><Link href={ctx.href(`/p/${p.slug}`)} className="after:absolute after:inset-0">{ctx.name(p)}</Link></h3>
                  <span aria-hidden className="h-px min-w-4 flex-1 border-b-2 border-dotted border-[#d8c8b2]" />
                  <span className="shrink-0 font-bold text-[var(--p)]">{p.inStock ? priceText(ctx, p) : ctx.t('outOfStock')}</span>
                </li>
              ))}
            </ul>
          ) : <p className={coffeeHouse.ui.muted}>{ctx.t('emptyStore')}</p>}
        </section>

        {products.length > 1 ? (
          <section aria-label={ctx.t('newArrivals')}>
            <ul className={coffeeHouse.ui.grid}>{products.slice(0, 6).map((p) => <li key={p.id}><coffeeHouse.Card ctx={ctx} product={p} /></li>)}</ul>
          </section>
        ) : null}
      </div>
    );
  },

  Card({ ctx, product: p, priority }) {
    const name = ctx.name(p);
    return (
      <article className="group relative flex h-full flex-col rounded-[2rem] bg-white p-3 shadow-[0_10px_30px_-18px_rgba(59,42,32,0.45)] transition hover:-translate-y-1">
        <ProductImage image={p.images[0]} alt={imageAlt(ctx, p.images[0], name)} priority={priority} sizes="(min-width:1024px) 30vw, 50vw"
          className="aspect-[4/3] w-full rounded-[1.5rem] object-cover" fallbackClass="bg-[#faf4ea] text-[var(--p)]" />
        <div className="flex flex-1 flex-col gap-1 px-2 pb-2 pt-4">
          <h3 className="font-semibold leading-snug"><Link href={ctx.href(`/p/${p.slug}`)} className="after:absolute after:inset-0">{name}</Link></h3>
          {p.brand ? <p className="text-xs text-[#8a7566]">{p.brand}</p> : null}
          <p className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
            <span className="font-bold text-[var(--p)]">{priceText(ctx, p)}</span>
            <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${p.inStock ? 'bg-[#e9f3df] text-[#35521c]' : 'bg-[#f1e7d8] text-[#8a7566]'}`}>{p.inStock ? ctx.t('inStock') : ctx.t('outOfStock')}</span>
          </p>
        </div>
      </article>
    );
  },

  Product({ ctx, product: p, buyBox }) {
    const name = ctx.name(p);
    const description = ctx.locale === 'ar' ? p.descriptionAr || p.descriptionEn : p.descriptionEn || p.descriptionAr;
    return (
      <div className="mx-auto max-w-6xl space-y-12 px-4 py-8">
        <div className="grid items-start gap-8 md:grid-cols-2">
          <div>
            <ProductImage image={p.images[0]} alt={imageAlt(ctx, p.images[0], name)} priority sizes="(min-width:768px) 50vw, 100vw"
              className="aspect-square w-full rounded-[2.5rem] object-cover" fallbackClass="bg-white text-[var(--p)]" />
            {p.images.length > 1 ? (
              <ul className="mt-4 flex gap-3">
                {p.images.slice(1, 5).map((img) => <li key={img.id}><ProductImage image={img} alt={imageAlt(ctx, img, name)} sizes="80px" className="size-20 rounded-3xl object-cover" /></li>)}
              </ul>
            ) : null}
          </div>
          <div className={`${coffeeHouse.ui.panel} space-y-6`}>
            {p.categories[0] ? <Link href={ctx.href(`/c/${p.categories[0].slug}`)} className="inline-block rounded-full bg-[#faf4ea] px-4 py-1.5 text-xs font-semibold text-[var(--p)]">{ctx.name(p.categories[0])}</Link> : null}
            <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{name}</h1>
            {buyBox}
            {description ? (
              <section className="border-t border-dashed border-[#e6d9c5] pt-5">
                <h2 className="mb-2 font-bold">{ctx.t('description')}</h2>
                <p className="whitespace-pre-line leading-8 text-[#6b5647]">{description}</p>
              </section>
            ) : null}
          </div>
        </div>
        {p.related.length ? (
          <section>
            <h2 className="mb-6 text-2xl font-bold">{ctx.t('related')}</h2>
            <ul className={coffeeHouse.ui.grid}>{p.related.slice(0, 3).map((r) => <li key={r.id}><coffeeHouse.Card ctx={ctx} product={r} /></li>)}</ul>
          </section>
        ) : null}
      </div>
    );
  },
};
