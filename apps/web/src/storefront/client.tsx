'use client';

import { useActionState, useMemo, useRef, useState, type ReactNode } from 'react';
import { addToCartAction, updateCartAction, type CartActionState } from './actions';
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
