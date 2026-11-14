import Link from 'next/link';
import { Search, ShoppingBag } from 'lucide-react';
import { LocaleLink } from '../client';
import { ProductImage, SearchForm, announcementText, heroText, imageAlt, priceText } from '../components';
import type { Theme } from '../theme';

/**
 * Gulf Premium: Arabic-first. Kufi type, an eight-point-star lattice as the
 * recurring motif, double-ruled frames around images and panels, and a calm
 * sand-and-teal palette.
 */
// Eight-point star lattice, used as a faint overlay.
const lattice = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Cg fill='none' stroke='%23000' stroke-width='1'%3E%3Crect x='12' y='12' width='24' height='24'/%3E%3Crect x='12' y='12' width='24' height='24' transform='rotate(45 24 24)'/%3E%3C/g%3E%3C/svg%3E\")",
  backgroundSize: '48px 48px',
} as const;
const Lattice = ({ className }: { className: string }) => <div aria-hidden style={lattice} className={className} />;
const frame = 'border border-[var(--p)]/40 p-1.5 outline outline-1 outline-offset-4 outline-[var(--p)]/20';
const btn = 'inline-flex h-12 items-center justify-center bg-[var(--p)] px-8 text-sm font-semibold text-[var(--on-p)] transition hover:brightness-110 disabled:opacity-50';
const Divider = () => (
  <span aria-hidden className="flex items-center gap-3 text-[var(--a)]">
    <span className="h-px flex-1 bg-current opacity-40" /><span className="size-2.5 rotate-45 border border-current" /><span className="h-px flex-1 bg-current opacity-40" />
  </span>
);

export const gulfPremium: Theme = {
  id: 'gulf-premium',
  root: 'bg-[#fbfaf6] text-[#1f2a2a] font-[family-name:var(--font-kufi)]',
  ui: {
    container: 'mx-auto w-full max-w-6xl px-5 py-12',
    h1: 'text-3xl font-bold text-[var(--p)]',
    muted: 'text-sm text-[#6b7474]',
    grid: 'grid grid-cols-2 gap-6 lg:grid-cols-4',
    button: btn,
    buttonGhost: 'inline-flex h-11 items-center justify-center border border-[var(--p)] px-6 text-sm font-semibold text-[var(--p)] hover:bg-[var(--p)] hover:text-[var(--on-p)]',
    input: 'h-11 border border-[#d9d4c7] bg-white px-4 text-sm',
    panel: 'border border-[var(--p)]/30 bg-white p-6',
    chip: 'border border-[#d9d4c7] bg-white px-4 py-2 text-sm hover:border-[var(--p)]',
    chipActive: 'border border-[var(--p)] bg-[var(--p)] px-4 py-2 text-sm font-semibold text-[var(--on-p)]',
    error: 'border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800',
    success: 'border border-[var(--p)]/40 bg-white px-4 py-3 text-sm text-[var(--p)]',
  },
  buy: {
    price: 'text-3xl font-bold text-[var(--p)]',
    compare: 'text-base text-[#9aa1a1]',
    label: 'text-sm font-semibold text-[#445050]',
    option: 'min-w-14 border border-[#d9d4c7] bg-white px-5 py-2.5 text-sm',
    optionActive: 'border-[var(--p)] text-[var(--p)] shadow-[inset_0_0_0_1px_var(--p)]',
    optionDisabled: 'text-[#b9bfbf] line-through',
    select: 'h-12 border border-[#d9d4c7] bg-white px-4 text-sm',
    button: `${btn} flex-1`,
    stock: 'text-sm font-medium text-[var(--a)]',
    error: 'border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800',
    success: 'border border-[var(--p)]/40 bg-white px-4 py-3 text-sm text-[var(--p)]',
  },

  Layout({ ctx, children }) {
    const note = announcementText(ctx);
    return (
      <>
        <div className="bg-[var(--p)] text-[var(--on-p)]">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-2 text-xs">
            <p className="truncate">{note}</p>
            <LocaleLink to={ctx.locale === 'ar' ? 'en' : 'ar'} className="shrink-0 underline-offset-4 hover:underline">{ctx.t('otherLanguage')}</LocaleLink>
          </div>
        </div>
        <header className="bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-5 py-5">
            <Link href={ctx.href()} className="flex items-center gap-3 text-2xl font-bold text-[var(--p)]">
              <span aria-hidden className="relative grid size-9 place-items-center">
                <span className="absolute inset-0 border-2 border-[var(--a)]" /><span className="absolute inset-0 rotate-45 border-2 border-[var(--p)]" />
              </span>
              {ctx.shop.name}
            </Link>
            <nav aria-label={ctx.t('categories')} className="order-3 w-full md:order-none md:w-auto md:flex-1">
              <ul className="flex gap-6 overflow-x-auto text-sm font-medium">
                <li><Link href={ctx.href('/products')} className="block whitespace-nowrap py-1 hover:text-[var(--p)]">{ctx.t('allProducts')}</Link></li>
                {ctx.nav.map((c) => <li key={c.id}><Link href={ctx.href(`/c/${c.slug}`)} className="block whitespace-nowrap py-1 hover:text-[var(--p)]">{ctx.name(c)}</Link></li>)}
              </ul>
            </nav>
            <Link href={ctx.href('/cart')} className="ms-auto flex items-center gap-2 border border-[var(--p)]/40 px-4 py-2 text-sm font-semibold text-[var(--p)] hover:bg-[var(--p)] hover:text-[var(--on-p)] md:ms-0">
              <ShoppingBag className="size-4" aria-hidden />{ctx.t('cart')}
              <span data-testid="cart-count" className="grid min-w-5 place-items-center bg-[var(--a)] px-1 text-xs text-[var(--on-a)]">{ctx.cartCount}</span>
            </Link>
          </div>
          <Lattice className="h-3 opacity-25" />
        </header>
        <main>{children}</main>
        <footer className="mt-20 bg-[#16201f] text-[#d7dcd9]">
          <Lattice className="h-3 opacity-20 invert" />
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-[2fr_1fr_1fr]">
            <div>
              <p className="text-xl font-bold text-white">{ctx.shop.name}</p>
              <SearchForm ctx={ctx} className="mt-5 flex max-w-sm border border-white/25"
                inputClass="h-11 min-w-0 flex-1 bg-transparent px-4 text-sm text-white outline-none placeholder:text-[#8f9a97]" buttonClass="grid size-11 place-items-center bg-[var(--a)] text-[var(--on-a)]">
                <Search className="size-4" aria-hidden />
              </SearchForm>
            </div>
            <ul className="space-y-2 text-sm">
              <li><Link href={ctx.href('/products')} className="hover:text-white">{ctx.t('allProducts')}</Link></li>
              {ctx.nav.slice(0, 4).map((c) => <li key={c.id}><Link href={ctx.href(`/c/${c.slug}`)} className="hover:text-white">{ctx.name(c)}</Link></li>)}
            </ul>
            <p className="text-sm sm:text-end">© {new Date().getFullYear()} {ctx.shop.name}<br />{ctx.t('rights')}</p>
          </div>
        </footer>
      </>
    );
  },

  homeWrap: '',

  Hero({ ctx }) {
    const { title, subtitle } = heroText(ctx);
    return (
      <section className="relative overflow-hidden border-b border-[var(--p)]/15 bg-[#f3efe4]">
        <Lattice className="absolute inset-0 opacity-[0.07]" />
        <div className="relative mx-auto max-w-6xl px-5 py-14 sm:py-20">
          <div className={`${frame} mx-auto max-w-3xl bg-[#fbfaf6]`}>
            <div className="px-6 py-12 text-center sm:px-12 sm:py-16">
              <h1 className="text-4xl font-bold leading-[1.4] text-[var(--p)] sm:text-6xl sm:leading-[1.35]">{title}</h1>
              <div className="mx-auto my-6 max-w-xs"><Divider /></div>
              {subtitle ? <p className="mx-auto max-w-xl text-lg leading-9 text-[#445050]">{subtitle}</p> : null}
              <Link href={ctx.href('/products')} className={`${btn} mt-8`}>{ctx.t('shopNow')}</Link>
            </div>
          </div>
        </div>
      </section>
    );
  },

  Categories({ ctx }) {
    if (!ctx.nav.length) return null;
    return (
        <section aria-label={ctx.t('categories')} className="mx-auto max-w-6xl px-5 pt-14">
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {ctx.nav.slice(0, 4).map((c) => (
              <li key={c.id}>
                <Link href={ctx.href(`/c/${c.slug}`)} className="group flex flex-col items-center gap-4 border border-[#e4dfd2] bg-white px-4 py-8 text-center transition hover:border-[var(--p)]">
                  <span aria-hidden className="relative grid size-12 place-items-center">
                    <span className="absolute inset-0 border border-[var(--a)]" /><span className="absolute inset-0 rotate-45 border border-[var(--p)] transition group-hover:rotate-[135deg]" />
                  </span>
                  <span className="font-semibold">{ctx.name(c)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
    );
  },

  Products({ ctx, products, heading, moreHref, id }) {
    return (
      <section aria-labelledby={id} className="mx-auto max-w-6xl px-5 pt-16">
        <div className="mb-8 text-center">
          <h2 id={id} className="text-3xl font-bold text-[var(--p)]">{heading}</h2>
          <div className="mx-auto mt-4 max-w-[12rem]"><Divider /></div>
        </div>
        {products.length ? (
          <ul className={gulfPremium.ui.grid}>{products.map((p, i) => <li key={p.id}><gulfPremium.Card ctx={ctx} product={p} priority={i < 4} /></li>)}</ul>
        ) : <p className="text-center text-sm text-[#6b7474]">{ctx.t('emptyStore')}</p>}
        <p className="mt-10 text-center"><Link href={moreHref} className={gulfPremium.ui.buttonGhost}>{ctx.t('viewAll')}</Link></p>
      </section>
    );
  },

  Card({ ctx, product: p, priority }) {
    const name = ctx.name(p);
    return (
      <article className="group relative flex h-full flex-col border border-[#e4dfd2] bg-white p-2 text-center transition hover:border-[var(--p)]">
        <div className="border border-[var(--p)]/15">
          <ProductImage image={p.images[0]} alt={imageAlt(ctx, p.images[0], name)} priority={priority} sizes="(min-width:1024px) 25vw, 50vw"
            className="aspect-square w-full object-cover" fallbackClass="bg-[#f3efe4] text-[var(--p)]" />
        </div>
        <div className="flex flex-1 flex-col gap-2 px-2 pb-4 pt-5">
          <h3 className="font-semibold leading-7"><Link href={ctx.href(`/p/${p.slug}`)} className="after:absolute after:inset-0">{name}</Link></h3>
          <p className="mt-auto font-bold text-[var(--p)]">
            {priceText(ctx, p)} {p.compareAtPrice ? <s className="ms-2 text-sm font-normal text-[#9aa1a1]">{ctx.money(p.compareAtPrice)}</s> : null}
          </p>
          {!p.inStock ? <p className="text-xs font-medium text-[var(--a)]">{ctx.t('outOfStock')}</p> : null}
        </div>
      </article>
    );
  },

  Product({ ctx, product: p, buyBox }) {
    const name = ctx.name(p);
    const description = ctx.locale === 'ar' ? p.descriptionAr || p.descriptionEn : p.descriptionEn || p.descriptionAr;
    return (
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid items-start gap-12 md:grid-cols-2">
          <div>
            <div className={frame}>
              <ProductImage image={p.images[0]} alt={imageAlt(ctx, p.images[0], name)} priority sizes="(min-width:768px) 50vw, 100vw"
                className="aspect-square w-full object-cover" fallbackClass="bg-[#f3efe4] text-[var(--p)]" />
            </div>
            {p.images.length > 1 ? (
              <ul className="mt-6 flex gap-3">
                {p.images.slice(1, 5).map((img) => <li key={img.id}><ProductImage image={img} alt={imageAlt(ctx, img, name)} sizes="80px" className="size-20 border border-[#e4dfd2] object-cover" /></li>)}
              </ul>
            ) : null}
          </div>
          <div className="space-y-6">
            {p.categories[0] ? <Link href={ctx.href(`/c/${p.categories[0].slug}`)} className="text-sm font-semibold text-[var(--a)]">{ctx.name(p.categories[0])}</Link> : null}
            <h1 className="text-3xl font-bold leading-[1.5] text-[var(--p)] sm:text-4xl sm:leading-[1.5]">{name}</h1>
            <Divider />
            {buyBox}
            {description ? (
              <section className={gulfPremium.ui.panel}>
                <h2 className="mb-3 font-bold text-[var(--p)]">{ctx.t('description')}</h2>
                <p className="whitespace-pre-line leading-9 text-[#445050]">{description}</p>
              </section>
            ) : null}
          </div>
        </div>
        {p.related.length ? (
          <section className="mt-20">
            <h2 className="mb-8 text-center text-2xl font-bold text-[var(--p)]">{ctx.t('related')}</h2>
            <ul className={gulfPremium.ui.grid}>{p.related.map((r) => <li key={r.id}><gulfPremium.Card ctx={ctx} product={r} /></li>)}</ul>
          </section>
        ) : null}
      </div>
    );
  },
};
