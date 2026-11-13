'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { currencyDecimals, generateVariantMatrix, marginPercent, toMinor } from '@mtjari/shared';
import { Button, Input, Label } from '@/components/ui';

export interface EditorVariant {
  id?: string;
  optionValues: Record<string, string>;
  sku: string; barcode: string; price: string; compareAtPrice: string; cost: string;
  trackInventory: boolean; lowStockThreshold: string; initialStock: string;
  /** Current stock of an existing variant (read-only here; changed on the Inventory page). */
  stockQuantity?: number;
}
interface EditorOption { name: string; values: string }

export type EditorLabels = Record<
  'sku' | 'barcode' | 'price' | 'compare' | 'cost' | 'margin' | 'track' | 'initial' | 'threshold' | 'options' | 'optionName' | 'optionValues' | 'optionAdd' | 'generate' | 'stock',
  string
>;

const blank = (optionValues: Record<string, string> = {}): EditorVariant => ({
  optionValues, sku: '', barcode: '', price: '', compareAtPrice: '', cost: '', trackInventory: true, lowStockThreshold: '', initialStock: '',
});
const comboKey = (o: Record<string, string>) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('|');
const splitValues = (s: string) => [...new Set(s.split(/[,،]/).map((v) => v.trim()).filter(Boolean))];

export function VariantEditor({
  type, currency, labels, initialOptions = [], initialVariants,
}: {
  type: 'SIMPLE' | 'VARIANT' | 'DIGITAL';
  currency: string;
  labels: EditorLabels;
  initialOptions?: { name: string; values: string[] }[];
  initialVariants?: EditorVariant[];
}) {
  const [options, setOptions] = useState<EditorOption[]>(
    initialOptions.length ? initialOptions.map((o) => ({ name: o.name, values: o.values.join(', ') })) : type === 'VARIANT' ? [{ name: '', values: '' }] : [],
  );
  const [rows, setRows] = useState<EditorVariant[]>(initialVariants?.length ? initialVariants : [blank()]);
  const hasOptions = type === 'VARIANT';
  const digital = type === 'DIGITAL';
  const placeholder = (0).toFixed(currencyDecimals(currency));

  const cleanOptions = useMemo(
    () => options.map((o) => ({ name: o.name.trim(), values: splitValues(o.values) })).filter((o) => o.name && o.values.length),
    [options],
  );
  // SIMPLE/DIGITAL products always submit exactly one variant without options.
  const submitted = hasOptions ? rows : [{ ...(rows[0] ?? blank()), optionValues: {} }];

  const set = (i: number, patch: Partial<EditorVariant>) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  function generate() {
    const existing = new Map(rows.map((r) => [comboKey(r.optionValues), r]));
    const template = rows[0];
    setRows(
      generateVariantMatrix(cleanOptions).slice(0, 100).map((optionValues) =>
        existing.get(comboKey(optionValues)) ??
        { ...blank(optionValues), price: template?.price ?? '', compareAtPrice: template?.compareAtPrice ?? '', cost: template?.cost ?? '', lowStockThreshold: template?.lowStockThreshold ?? '' },
      ),
    );
  }

  const cell = 'h-9 px-2.5 text-sm';
  return (
    <div className="space-y-4">
      <input type="hidden" name="optionsJson" value={JSON.stringify(hasOptions ? cleanOptions : [])} />
      <input type="hidden" name="variantsJson" value={JSON.stringify(submitted)} />

      {hasOptions ? (
        <fieldset className="space-y-3 rounded-2xl border border-slate-200/80 p-4">
          <legend className="px-1 text-sm font-medium">{labels.options}</legend>
          {options.map((o, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
              <Input aria-label={labels.optionName} placeholder={labels.optionName} value={o.name} maxLength={40}
                onChange={(e) => setOptions((all) => all.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))} />
              <Input aria-label={labels.optionValues} placeholder={labels.optionValues} value={o.values}
                onChange={(e) => setOptions((all) => all.map((x, idx) => (idx === i ? { ...x, values: e.target.value } : x)))} />
              <Button type="button" variant="ghost" aria-label="remove" onClick={() => setOptions((all) => all.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {options.length < 3 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setOptions((all) => [...all, { name: '', values: '' }])}><Plus className="size-3.5" />{labels.optionAdd}</Button>
            ) : null}
            <Button type="button" size="sm" disabled={!cleanOptions.length} onClick={generate}>{labels.generate}</Button>
          </div>
        </fieldset>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="bg-slate-50/70 text-xs text-slate-500 dark:bg-slate-800/40">
            <tr>
              {hasOptions ? <th className="px-3 py-2 text-start font-medium" /> : null}
              {[labels.price, labels.compare, labels.cost, labels.margin, labels.sku, labels.barcode, ...(digital ? [] : [labels.track, labels.initial, labels.threshold])].map((h) => (
                <th key={h} className="px-2 py-2 text-start font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(hasOptions ? rows : rows.slice(0, 1)).map((r, i) => {
              const price = toMinor(r.price, currency);
              const cost = r.cost ? toMinor(r.cost, currency) : null;
              const margin = price !== null ? marginPercent(price, cost) : null;
              const name = Object.values(r.optionValues).join(' / ');
              const n = (field: string) => `${field}${hasOptions ? ` ${name}` : ''}`;
              return (
                <tr key={r.id ?? comboKey(r.optionValues) + i} className="border-t border-slate-200/70">
                  {hasOptions ? <td className="whitespace-nowrap px-3 py-2 font-medium">{name}</td> : null}
                  <td className="px-2 py-2"><Input aria-label={n(labels.price)} className={`${cell} w-24`} dir="ltr" inputMode="decimal" required placeholder={placeholder} value={r.price} onChange={(e) => set(i, { price: e.target.value })} /></td>
                  <td className="px-2 py-2"><Input aria-label={n(labels.compare)} className={`${cell} w-24`} dir="ltr" inputMode="decimal" value={r.compareAtPrice} onChange={(e) => set(i, { compareAtPrice: e.target.value })} /></td>
                  <td className="px-2 py-2"><Input aria-label={n(labels.cost)} className={`${cell} w-24`} dir="ltr" inputMode="decimal" value={r.cost} onChange={(e) => set(i, { cost: e.target.value })} /></td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-600" dir="ltr" data-testid="margin">{margin === null ? '—' : `${margin}%`}</td>
                  <td className="px-2 py-2"><Input aria-label={n(labels.sku)} className={`${cell} w-28`} dir="ltr" maxLength={64} value={r.sku} onChange={(e) => set(i, { sku: e.target.value })} /></td>
                  <td className="px-2 py-2"><Input aria-label={n(labels.barcode)} className={`${cell} w-28`} dir="ltr" maxLength={64} value={r.barcode} onChange={(e) => set(i, { barcode: e.target.value })} /></td>
                  {digital ? null : (
                    <>
                      <td className="px-2 py-2 text-center"><input type="checkbox" aria-label={n(labels.track)} className="size-4 accent-[#2563EB]" checked={r.trackInventory} onChange={(e) => set(i, { trackInventory: e.target.checked })} /></td>
                      <td className="px-2 py-2">
                        {r.id ? <span className="px-2 text-slate-600" title={labels.stock}>{r.trackInventory ? r.stockQuantity : '—'}</span> : (
                          <Input aria-label={n(labels.initial)} className={`${cell} w-20`} dir="ltr" inputMode="numeric" disabled={!r.trackInventory} value={r.initialStock} onChange={(e) => set(i, { initialStock: e.target.value.replace(/\D/g, '') })} />
                        )}
                      </td>
                      <td className="px-2 py-2"><Input aria-label={n(labels.threshold)} className={`${cell} w-20`} dir="ltr" inputMode="numeric" disabled={!r.trackInventory} value={r.lowStockThreshold} onChange={(e) => set(i, { lowStockThreshold: e.target.value.replace(/\D/g, '') })} /></td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasOptions ? <Label className="text-xs font-normal text-slate-500">{rows.length} / 100</Label> : null}
    </div>
  );
}
