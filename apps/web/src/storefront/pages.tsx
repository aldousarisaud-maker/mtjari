import Link from 'next/link';
import { CartLineControls } from './client';
import { Pager } from './components';
import type { PageContext } from './context';
import type { Cart, ProductList, ShopCategory } from './types';

const SORTS = ['newest', 'price_asc', 'price_desc'] as const;
export type Sort = (typeof SORTS)[number];
export const parseSort = (v: unknown): Sort => (SORTS as readonly string[]).includes(v as string) ? (v as Sort) : 'newest';
export const parsePage = (v: unknown) => (typeof v === 'string' && /^\d{1,4}$/.test(v) ? Math.max(1, Number(v)) : 1);

/** Product listing shared by "all products", search results and category pages; the theme supplies the card and the classes. */
export function ListingView({
  pc, title, intro, list, basePath, q, sort, subcategories,
}: {
  pc: PageContext; title: string; intro?: string; list: ProductList; basePath: string; q?: string; sort: Sort; subcategories?: ShopCategory[];
}) {
  const { ctx, theme } = pc;
  const { ui, Card } = theme;
  const hrefFor = (over: { sort?: Sort; page?: number }) => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    const s = over.sort ?? sort;
    if (s !== 'newest') qs.set('sort', s);
    if (over.page && over.page > 1) qs.set('page', String(over.page));
    const str = qs.toString();
    return ctx.href(basePath) + (str ? `?${str}` : '');
  };
  return (
    <div className={ui.container}>
      <h1 className={ui.h1}>{title}</h1>
      {intro ? <p className={`${ui.muted} mt-3 max-w-2xl`}>{intro}</p> : null}
      {subcategories?.length ? (
        <ul className="mt-6 flex flex-wrap gap-2">
          {subcategories.map((c) => <li key={c.id}><Link href={ctx.href(`/c/${c.slug}`)} className={ui.chip}>{ctx.name(c)}</Link></li>)}
        </ul>
      ) : null}
      <div className="mb-6 mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className={ui.muted} data-testid="result-count">{list.total} {ctx.t('results')}</p>
        <ul className="flex flex-wrap items-center gap-2" aria-label={ctx.t('sortBy')}>
          {SORTS.map((s) => (
            <li key={s}><Link href={hrefFor({ sort: s })} aria-current={s === sort ? 'true' : undefined} className={s === sort ? ui.chipActive : ui.chip}>{ctx.t(`sort_${s}`)}</Link></li>
          ))}
        </ul>
      </div>
      {list.items.length ? (
        <ul className={ui.grid}>{list.items.map((p, i) => <li key={p.id}><Card ctx={ctx} product={p} priority={i < 4} /></li>)}</ul>
      ) : <p className={`${ui.muted} py-16 text-center`}>{ctx.t('noResults')}</p>}
      <Pager ctx={ctx} ui={ui} page={list.page} total={list.total} limit={list.limit} hrefFor={(page) => hrefFor({ page })} />
    </div>
  );
}

export function CartView({ pc, cart }: { pc: PageContext; cart: Cart }) {
  const { ctx, theme } = pc;
  const { ui } = theme;
  return (
    <div className={ui.container}>
      <h1 className={ui.h1}>{ctx.t('cart')}</h1>
      {cart.items.length ? (
        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_20rem]">
          <ul className="space-y-4">
            {cart.items.map((line) => {
              const options = Object.values(line.optionValues).join(' / ');
              return (
                <li key={line.id} className={`${ui.panel} flex gap-4`} data-testid="cart-line">
                  {line.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={line.image} alt="" width={96} height={96} loading="lazy" className="size-20 shrink-0 object-cover sm:size-24" />
                  ) : <span aria-hidden className="size-20 shrink-0 bg-current opacity-10 sm:size-24" />}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h2 className="font-semibold"><Link href={ctx.href(`/p/${line.slug}`)}>{ctx.name(line)}</Link></h2>
                      <p className="font-semibold" data-testid="line-total">{ctx.money(line.lineTotal)}</p>
                    </div>
                    <p className={ui.muted}>{options ? `${options} · ` : ''}{ctx.money(line.unitPrice)}</p>
                    {line.issue === 'unavailable' ? <p role="alert" className={ui.error}>{ctx.t('lineUnavailable')}</p> : null}
                    {line.issue === 'insufficient_stock' ? <p role="alert" className={ui.error}>{ctx.t('lineLow')} {line.maxQuantity}</p> : null}
                    <CartLineControls locale={ctx.locale} itemId={line.id} quantity={line.quantity} max={Math.max(line.maxQuantity, 1)}
                      labels={{ quantity: ctx.t('quantity'), remove: ctx.t('remove'), update: ctx.t('update') }}
                      selectClass={ui.input} removeClass={`${ui.muted} underline underline-offset-4`} errorClass={ui.error} />
                  </div>
                </li>
              );
            })}
          </ul>
          <aside className={`${ui.panel} space-y-4`}>
            <p className="flex items-baseline justify-between gap-4 text-lg font-semibold">
              <span>{ctx.t('subtotal')}</span><span data-testid="subtotal">{ctx.money(cart.subtotal)}</span>
            </p>
            {/* No checkout button until checkout exists (Phase 4): the shopper is told plainly. */}
            {!cart.checkoutAvailable ? <p className={ui.muted} data-testid="checkout-note">{ctx.t('checkoutSoon')}</p> : null}
            <Link href={ctx.href('/products')} className={ui.buttonGhost}>{ctx.t('continueShopping')}</Link>
          </aside>
        </div>
      ) : (
        <div className="py-16 text-center">
          <p className={ui.muted}>{ctx.t('emptyCart')}</p>
          <Link href={ctx.href('/products')} className={`${ui.button} mt-6`}>{ctx.t('continueShopping')}</Link>
        </div>
      )}
    </div>
  );
}
