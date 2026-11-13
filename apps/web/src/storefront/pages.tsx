import Link from 'next/link';
import { PHONE_RULES } from '@mtjari/shared';
import { CartLineControls, CheckoutForm } from './client';
import { pickText } from './i18n';
import { Pager } from './components';
import type { PageContext } from './context';
import type { Cart, CheckoutInfo, ProductList, ShopCategory, ShopOrder } from './types';

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
            {/* A checkout button exists only when the store can really take the order. */}
            {cart.checkoutAvailable
              ? <Link href={ctx.href('/checkout')} className={`${ui.button} w-full`} data-testid="checkout-link">{ctx.t('checkout')}</Link>
              : <p className={ui.muted} data-testid="checkout-note">{ctx.t('checkoutSoon')}</p>}
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

export function CheckoutView({ pc, info, idempotencyKey }: { pc: PageContext; info: CheckoutInfo; idempotencyKey: string }) {
  const { ctx, theme } = pc;
  const { ui } = theme;
  const { cart } = info;
  const blocked = cart.items.some((i) => i.issue);
  const belowMinimum = cart.subtotal < info.minOrderAmount;
  const t = ctx.t;
  return (
    <div className={ui.container}>
      <h1 className={ui.h1}>{t('checkout')}</h1>
      {!cart.items.length ? (
        <div className="py-16 text-center">
          <p className={ui.muted}>{t('emptyCart')}</p>
          <Link href={ctx.href('/products')} className={`${ui.button} mt-6`}>{t('continueShopping')}</Link>
        </div>
      ) : !info.available ? (
        <p role="alert" className={`${ui.error} mt-8`}>{t('checkoutUnavailable')}</p>
      ) : blocked || belowMinimum ? (
        <div className="mt-8 space-y-4">
          <p role="alert" className={ui.error}>
            {blocked ? t('err.cart_changed') : `${t('err.below_minimum_order')} ${t('minimumOrder')}: ${ctx.money(info.minOrderAmount)}`}
          </p>
          <Link href={ctx.href('/cart')} className={ui.buttonGhost}>{t('viewCart')}</Link>
        </div>
      ) : (
        <>
          <ul className={`${ui.muted} mt-4 space-y-1`} aria-label={t('items')}>
            {cart.items.map((i) => <li key={i.id}>{ctx.name(i)}{Object.values(i.optionValues).length ? ` (${Object.values(i.optionValues).join(' / ')})` : ''} × {i.quantity}</li>)}
          </ul>
          <CheckoutForm
            locale={ctx.locale} currency={cart.currency} subtotal={cart.subtotal} subtotalText={ctx.money(cart.subtotal)} idempotencyKey={idempotencyKey}
            phonePlaceholder={PHONE_RULES[info.country] ? `+${PHONE_RULES[info.country]!.dial}` : ''}
            zones={info.zones.map((z) => ({ id: z.id, name: ctx.name(z), fee: z.fee, freeAbove: z.freeAbove }))}
            pickup={{ enabled: info.pickup.enabled, instructions: pickText(ctx.locale, info.pickup.instructionsAr, info.pickup.instructionsEn) }}
            methods={info.paymentMethods.map((m) => ({ provider: m.provider, name: m.name[ctx.locale] }))}
            classes={{ panel: ui.panel, input: ui.input, button: ui.button, muted: ui.muted, error: ui.error, chip: ui.chip, chipActive: ui.chipActive }}
            labels={{
              yourDetails: t('yourDetails'), fullName: t('fullName'), phone: t('phone'), emailOptional: t('emailOptional'), emailHint: t('emailHint'),
              receiveBy: t('receiveBy'), delivery: t('delivery'), pickup: t('pickup'), deliveryArea: t('deliveryArea'), chooseArea: t('chooseArea'),
              area: t('area'), block: t('block'), street: t('street'), avenue: t('avenue'), building: t('building'), floor: t('floor'), apartment: t('apartment'),
              directions: t('directions'), orderNote: t('orderNote'), paymentMethod: t('paymentMethod'), orderSummary: t('orderSummary'), subtotal: t('subtotal'),
              deliveryFee: t('deliveryFee'), free: t('free'), chooseAreaForFee: t('chooseAreaForFee'), total: t('total'), placeOrder: t('placeOrder'),
            }}
          />
        </>
      )}
    </div>
  );
}

/** The page behind the shopper's private order link. */
export function OrderView({ pc, order }: { pc: PageContext; order: ShopOrder }) {
  const { ctx, theme } = pc;
  const { ui } = theme;
  const t = ctx.t;
  const a = order.address;
  const status = order.status === 'SHIPPED' && order.fulfillment === 'PICKUP' ? t('status_SHIPPED_PICKUP') : t(`status_${order.status}`);
  const pickup = pickText(ctx.locale, order.pickupInstructionsAr, order.pickupInstructionsEn);
  return (
    <div className={ui.container}>
      <h1 className={ui.h1}>{t('orderReceived')}</h1>
      <p className="mt-3 text-lg">{t('orderNumber')}: <strong data-testid="order-number">{order.number}</strong></p>
      {order.status === 'PENDING' ? <p className={`${ui.muted} mt-2`}>{t('orderThanks')}</p> : null}
      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
        <section className={`${ui.panel} space-y-4`} aria-label={t('items')}>
          <ul className="divide-y divide-current/10">
            {order.items.map((i, n) => {
              const options = Object.values(i.optionValues).join(' / ');
              return (
                <li key={n} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3" data-testid="order-line">
                  <span>{ctx.name(i)}{options ? ` (${options})` : ''} × {i.quantity}</span>
                  <span className="font-semibold">{ctx.money(i.lineTotal)}</span>
                </li>
              );
            })}
          </ul>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt>{t('subtotal')}</dt><dd>{ctx.money(order.subtotal)}</dd></div>
            {order.fulfillment === 'DELIVERY' ? (
              <div className="flex justify-between gap-4"><dt>{t('deliveryFee')}</dt><dd data-testid="order-delivery">{order.deliveryFee ? ctx.money(order.deliveryFee) : t('free')}</dd></div>
            ) : null}
            <div className="flex justify-between gap-4 border-t border-current/15 pt-3 text-base font-semibold"><dt>{t('total')}</dt><dd data-testid="order-total">{ctx.money(order.total)}</dd></div>
          </dl>
        </section>
        <aside className={`${ui.panel} space-y-4 text-sm`}>
          <p><span className={ui.muted}>{t('orderStatus')}</span><br /><strong data-testid="order-status">{status}</strong></p>
          <p><span className={ui.muted}>{t('payment')}</span><br /><span data-testid="order-payment">{order.paymentName[ctx.locale]} · {t(`pay_${order.paymentStatus}`)}</span></p>
          {a ? (
            <p><span className={ui.muted}>{t('deliveryAddress')}</span><br />
              <span data-testid="order-address">
                {ctx.locale === 'ar' ? a.zoneNameAr : a.zoneNameEn}، {a.area}، {t('block')} {a.block}، {a.street}{a.avenue ? `، ${a.avenue}` : ''}، {a.building}
                {a.floor ? `، ${a.floor}` : ''}{a.apartment ? `، ${a.apartment}` : ''}
              </span>
            </p>
          ) : (
            <p><span className={ui.muted}>{t('pickupFrom')}</span><br /><span>{pickup || t('pickup')}</span></p>
          )}
          <p><span className={ui.muted}>{t('fullName')}</span><br />{order.customerName} · <span dir="ltr">{order.customerPhone}</span></p>
          <p className={ui.muted}>{t('keepLink')}</p>
        </aside>
      </div>
    </div>
  );
}
