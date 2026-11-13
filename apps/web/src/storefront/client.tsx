'use client';

import { startTransition, useActionState, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { deliveryFeeFor, formatMoney } from '@mtjari/shared';
import { addToCartAction, placeOrderAction, updateCartAction, type CartActionState, type CheckoutState } from './actions';
import type { BuyClasses } from './theme';

export interface BuyVariant { id: string; optionValues: Record<string, string>; price: string; compare: string | null; available: boolean; maxQuantity: number }
export interface BuyLabels { add: string; outOfStock: string; inStock: string; quantity: string; viewCart: string }

const INITIAL: CartActionState = {};

/** Variant picker + quantity + add to cart. Prices are formatted on the server; the server action re-reads them from the catalogue. */
export function BuyBox({
  locale, options, variants, labels, classes: c, cartHref,
}: {
  locale: string; options: { name: string; values: string[] }[]; variants: BuyVariant[]; labels: BuyLabels; classes: BuyClasses; cartHref: string;
}) {
  const first = variants.find((v) => v.available) ?? variants[0]!;
  const [picked, setPicked] = useState<Record<string, string>>(first.optionValues);
  const [quantity, setQuantity] = useState(1);
  const [state, action, pending] = useActionState(addToCartAction, INITIAL);
  const variant = useMemo(
    () => variants.find((v) => options.every((o) => v.optionValues[o.name] === picked[o.name])) ?? first,
    [variants, options, picked, first],
  );
  const max = Math.max(1, variant.maxQuantity);
  const qty = Math.min(quantity, max);
  /** A value is selectable when some available variant has it together with the other current picks. */
  const valueAvailable = (name: string, value: string) =>
    variants.some((v) => v.available && v.optionValues[name] === value && options.every((o) => o.name === name || v.optionValues[o.name] === picked[o.name]));

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="variantId" value={variant.id} />
      <input type="hidden" name="quantity" value={qty} />
      <p className="flex flex-wrap items-baseline gap-3">
        <span className={c.price} data-testid="price">{variant.price}</span>
        {variant.compare ? <s className={c.compare}>{variant.compare}</s> : null}
      </p>
      {options.map((o) => (
        <fieldset key={o.name}>
          <legend className={c.label}>{o.name}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {o.values.map((value) => {
              const active = picked[o.name] === value;
              const ok = valueAvailable(o.name, value);
              return (
                <button key={value} type="button" aria-pressed={active} onClick={() => { setPicked((p) => ({ ...p, [o.name]: value })); setQuantity(1); }}
                  className={`${c.option} ${active ? c.optionActive : ''} ${ok ? '' : c.optionDisabled}`}>
                  {value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p className={c.stock} data-testid="availability">{variant.available ? labels.inStock : labels.outOfStock}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className={c.label}>{labels.quantity}</span>
          <select aria-label={labels.quantity} value={qty} disabled={!variant.available} onChange={(e) => setQuantity(Number(e.target.value))} className={`${c.select} mt-2 block`}>
            {Array.from({ length: Math.min(max, 10) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="submit" disabled={!variant.available || pending} aria-busy={pending} className={c.button}>
          {variant.available ? labels.add : labels.outOfStock}
        </button>
      </div>
      {state.error ? <p role="alert" className={c.error}>{state.error}</p> : null}
      {state.ok && !pending ? (
        <p role="status" className={c.success}>{state.ok} <a href={cartHref} className="underline underline-offset-4">{labels.viewCart}</a></p>
      ) : null}
    </form>
  );
}

/** Quantity selector and remove button for one cart line. */
export function CartLineControls({
  locale, itemId, quantity, max, labels, selectClass, removeClass, errorClass,
}: {
  locale: string; itemId: string; quantity: number; max: number; labels: { quantity: string; remove: string; update: string };
  selectClass: string; removeClass: string; errorClass: string;
}) {
  const [state, action, pending] = useActionState(updateCartAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  const top = Math.max(quantity, Math.min(max, 20));
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form ref={form} action={action} className="flex items-center gap-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="itemId" value={itemId} />
        <select name="quantity" aria-label={labels.quantity} defaultValue={quantity} key={quantity} disabled={pending} onChange={() => form.current?.requestSubmit()} className={selectClass}>
          {Array.from({ length: top }, (_, i) => i + 1).map((n) => <option key={n} value={n} disabled={n > max}>{n}</option>)}
        </select>
        <noscript><button type="submit" className={removeClass}>{labels.update}</button></noscript>
      </form>
      <form action={action}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="quantity" value="0" />
        <button type="submit" disabled={pending} className={removeClass}>{labels.remove}</button>
      </form>
      {state.error ? <p role="alert" className={errorClass}>{state.error}</p> : null}
    </div>
  );
}

/** Switches language and stays on the same page (falls back to the other language's home without JavaScript). */
export function LocaleLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return (
    <a href={`/${to}`} hrefLang={to} lang={to} className={className}
      onClick={(e) => {
        e.preventDefault();
        window.location.assign(`/${to}${window.location.pathname.replace(/^\/(ar|en)(?=\/|$)/, '')}${window.location.search}`);
      }}>
      {children}
    </a>
  );
}

export interface CheckoutLabels {
  yourDetails: string; fullName: string; phone: string; emailOptional: string; emailHint: string; receiveBy: string; delivery: string; pickup: string;
  deliveryArea: string; chooseArea: string; area: string; block: string; street: string; avenue: string; building: string; floor: string; apartment: string;
  directions: string; orderNote: string; paymentMethod: string; orderSummary: string; subtotal: string; deliveryFee: string; free: string; chooseAreaForFee: string;
  total: string; placeOrder: string;
}
export interface CheckoutClasses { panel: string; input: string; button: string; muted: string; error: string; chip: string; chipActive: string }

const CHECKOUT_INITIAL: CheckoutState = {};

/**
 * Checkout form. The totals shown here are for the shopper's information;
 * the server recomputes everything from the cart when the order is placed.
 */
export function CheckoutForm({
  locale, labels: L, classes: c, zones, pickup, methods, subtotal, subtotalText, currency, idempotencyKey, phonePlaceholder,
}: {
  locale: 'ar' | 'en'; labels: CheckoutLabels; classes: CheckoutClasses;
  zones: { id: string; name: string; fee: number; freeAbove: number | null }[];
  pickup: { enabled: boolean; instructions: string };
  methods: { provider: string; name: string }[];
  subtotal: number; subtotalText: string; currency: string; idempotencyKey: string; phonePlaceholder: string;
}) {
  const [state, action, pending] = useActionState(placeOrderAction, CHECKOUT_INITIAL);
  const canDeliver = zones.length > 0;
  const [fulfillment, setFulfillment] = useState<'DELIVERY' | 'PICKUP'>(canDeliver ? 'DELIVERY' : 'PICKUP');
  const [zoneId, setZoneId] = useState(zones.length === 1 ? zones[0]!.id : '');
  const zone = zones.find((z) => z.id === zoneId);
  const fee = fulfillment === 'PICKUP' ? 0 : zone ? deliveryFeeFor(zone, subtotal) : null;
  const money = (n: number) => formatMoney(n, currency, locale);
  const field = `${c.input} mt-1.5 block w-full`;
  const label = 'block text-sm font-medium';

  // Submitting through onSubmit keeps what the shopper typed when the server refuses the order.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  }

  return (
    <form action={action} onSubmit={onSubmit} className="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="space-y-6">
        <fieldset className={`${c.panel} space-y-4`}>
          <legend className="float-start mb-4 w-full text-lg font-semibold">{L.yourDetails}</legend>
          <div className="clear-both grid gap-4 sm:grid-cols-2">
            <label className={label}>{L.fullName}<input name="name" required maxLength={100} autoComplete="name" className={field} /></label>
            <label className={label}>{L.phone}<input name="phone" required type="tel" inputMode="tel" dir="ltr" maxLength={30} autoComplete="tel" placeholder={phonePlaceholder} className={field} /></label>
          </div>
          <label className={label}>{L.emailOptional}<input name="email" type="email" dir="ltr" maxLength={200} autoComplete="email" aria-describedby="email-hint" className={field} />
            <span id="email-hint" className={`${c.muted} mt-1 block font-normal`}>{L.emailHint}</span>
          </label>
        </fieldset>

        <fieldset className={`${c.panel} space-y-4`}>
          <legend className="float-start mb-4 w-full text-lg font-semibold">{L.receiveBy}</legend>
          <div className="clear-both flex flex-wrap gap-2">
            {canDeliver ? (
              <label className={`${fulfillment === 'DELIVERY' ? c.chipActive : c.chip} cursor-pointer`}>
                <input type="radio" name="fulfillment" value="DELIVERY" checked={fulfillment === 'DELIVERY'} onChange={() => setFulfillment('DELIVERY')} className="sr-only" />{L.delivery}
              </label>
            ) : null}
            {pickup.enabled ? (
              <label className={`${fulfillment === 'PICKUP' ? c.chipActive : c.chip} cursor-pointer`}>
                <input type="radio" name="fulfillment" value="PICKUP" checked={fulfillment === 'PICKUP'} onChange={() => setFulfillment('PICKUP')} className="sr-only" />{L.pickup}
              </label>
            ) : null}
          </div>
          {fulfillment === 'DELIVERY' ? (
            <div className="space-y-4">
              <label className={label}>{L.deliveryArea}
                <select name="zoneId" required value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={field}>
                  <option value="">{L.chooseArea}</option>
                  {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={label}>{L.area}<input name="area" required maxLength={80} autoComplete="address-level2" className={field} /></label>
                <label className={label}>{L.block}<input name="block" required maxLength={20} className={field} /></label>
                <label className={label}>{L.street}<input name="street" required maxLength={80} autoComplete="address-line1" className={field} /></label>
                <label className={label}>{L.avenue}<input name="avenue" maxLength={40} className={field} /></label>
                <label className={label}>{L.building}<input name="building" required maxLength={40} className={field} /></label>
                <label className={label}>{L.floor}<input name="floor" maxLength={20} className={field} /></label>
                <label className={label}>{L.apartment}<input name="apartment" maxLength={20} className={field} /></label>
              </div>
              <label className={label}>{L.directions}<input name="directions" maxLength={300} className={field} /></label>
            </div>
          ) : pickup.instructions ? <p className={c.muted} data-testid="pickup-instructions">{pickup.instructions}</p> : null}
        </fieldset>

        <fieldset className={`${c.panel} space-y-3`}>
          <legend className="float-start mb-4 w-full text-lg font-semibold">{L.paymentMethod}</legend>
          <div className="clear-both space-y-2">
            {methods.map((m, i) => (
              <label key={m.provider} className="flex cursor-pointer items-center gap-3 text-sm">
                <input type="radio" name="paymentProvider" value={m.provider} defaultChecked={i === 0} required />{m.name}
              </label>
            ))}
          </div>
        </fieldset>

        <label className={`${label} ${c.panel}`}>{L.orderNote}<textarea name="note" rows={3} maxLength={500} className={`${field} h-auto py-3`} /></label>
      </div>

      <aside className={`${c.panel} space-y-4`} aria-label={L.orderSummary}>
        <h2 className="text-lg font-semibold">{L.orderSummary}</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4"><dt>{L.subtotal}</dt><dd data-testid="summary-subtotal">{subtotalText}</dd></div>
          <div className="flex justify-between gap-4"><dt>{L.deliveryFee}</dt>
            <dd data-testid="summary-delivery">{fee === null ? L.chooseAreaForFee : fee === 0 ? L.free : money(fee)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-current/15 pt-3 text-base font-semibold"><dt>{L.total}</dt><dd data-testid="summary-total">{money(subtotal + (fee ?? 0))}</dd></div>
        </dl>
        {state.error ? <p role="alert" className={c.error}>{state.error}</p> : null}
        <button type="submit" disabled={pending} aria-busy={pending} className={`${c.button} w-full`}>{L.placeOrder}</button>
      </aside>
    </form>
  );
}
