import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ADJUST_REASONS, PERMISSIONS } from '@mtjari/shared';
import { adjustInventoryAction } from '@/app/catalog-actions';
import { Badge, Card, Input, Select, buttonClass } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, t, type Key } from '@/lib/i18n';
import { can, getStore } from '../data';
import { Pager } from '../pager';
import { displayName } from '../products/product-fields';
import { RowAction } from '../row-action';

interface ProductRef { id: string; nameAr: string | null; nameEn: string | null }
interface Row { id: string; sku: string | null; optionValues: Record<string, string>; stockQuantity: number; lowStockThreshold: number | null; low: boolean; product: ProductRef }
interface Movement { id: string; delta: number; quantityAfter: number; reason: string; createdAt: string; variant: { sku: string | null; optionValues: Record<string, string>; product: ProductRef } }

const optionText = (o: Record<string, string>) => Object.values(o ?? {}).join(' / ');

export default async function InventoryPage({ params, searchParams }: { params: Promise<{ locale: string; storeId: string }>; searchParams: Promise<{ q?: string; low?: string; page?: string }> }) {
  const { locale, storeId } = await params;
  const sp = await searchParams;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  if (!can(store, PERMISSIONS.INVENTORY_READ)) notFound();
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 100) : '';
  const low = sp.low === '1';
  const page = /^\d{1,4}$/.test(sp.page ?? '') ? Math.max(1, Number(sp.page)) : 1;
  const qs = new URLSearchParams({ page: String(page), limit: '30' });
  if (q) qs.set('q', q);
  if (low) qs.set('lowStock', 'true');
  const [res, moves] = await Promise.all([
    api<{ total: number; limit: number; items: Row[] }>(`/v1/stores/${store.id}/inventory?${qs}`),
    api<{ items: Movement[] }>(`/v1/stores/${store.id}/inventory/movements?limit=15`),
  ]);
  const items = res.ok ? res.data.items : [];
  const write = can(store, PERMISSIONS.INVENTORY_WRITE);
  const base = `/${l}/dashboard/${store.id}`;
  const fmt = new Intl.DateTimeFormat(l === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t(l, 'side.inventory')}</h1>

      <form method="get" className="glass flex flex-wrap items-center gap-3 p-4" role="search">
        <Input name="q" type="search" defaultValue={q} placeholder={t(l, 'p.search')} aria-label={t(l, 'p.search')} className="min-w-48 flex-1" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={low} className="size-4 accent-[#2563EB]" />{t(l, 'inv.lowOnly')}</label>
        <button type="submit" className={buttonClass({ variant: 'ghost' })}>{t(l, 'p.filter')}</button>
      </form>

      <Card className="overflow-x-auto p-0">
        {items.length ? (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                {(['p.name', 'p.sku', 'inv.qty'] as const).map((k) => <th key={k} className="px-5 py-3 text-start font-medium">{t(l, k)}</th>)}
                {write ? <th className="px-5 py-3 text-start font-medium">{t(l, 'inv.change')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className="border-t border-slate-200/70 align-top" data-testid="stock-row">
                  <td className="px-5 py-3">
                    <Link href={`${base}/products/${v.product.id}`} className="font-medium hover:text-primary" dir="auto">{displayName(l, v.product)}</Link>
                    {optionText(v.optionValues) ? <p className="text-xs text-slate-500" dir="auto">{optionText(v.optionValues)}</p> : null}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs" dir="ltr">{v.sku ?? '—'}</td>
                  <td className="whitespace-nowrap px-5 py-3 tabular-nums">
                    <span data-testid="qty">{v.stockQuantity}</span>
                    {v.low ? <Badge className="ms-2 bg-amber-100 text-amber-700">{t(l, 'p.low')}</Badge> : null}
                  </td>
                  {write ? (
                    <td className="px-5 py-3">
                      <RowAction action={adjustInventoryAction} fields={{ locale: l, storeId: store.id, variantId: v.id }} label={t(l, 'inv.apply')}>
                        <Input name="delta" required inputMode="numeric" pattern="[+\-]?[0-9٠-٩]{1,7}" placeholder="+5" aria-label={t(l, 'inv.change')} dir="ltr" className="h-8 w-20 px-2 text-xs" />
                        <Select name="reason" defaultValue="ADJUSTMENT" aria-label={t(l, 'inv.reason')} className="h-8 w-32 px-2 text-xs">
                          {ADJUST_REASONS.map((r) => <option key={r} value={r}>{t(l, `inv.r.${r}`)}</option>)}
                        </Select>
                      </RowAction>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="p-8 text-center text-sm text-slate-500">{t(l, 'inv.empty')}</p>}
      </Card>

      {res.ok ? <Pager locale={l} base={`${base}/inventory`} page={page} total={res.data.total} limit={res.data.limit} query={{ q, low: low ? '1' : '' }} /> : null}

      {moves.ok && moves.data.items.length ? (
        <Card className="overflow-x-auto p-0">
          <h2 className="px-5 pt-5 text-lg font-semibold">{t(l, 'inv.history')}</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>{(['audit.when', 'p.name', 'inv.reason', 'inv.change', 'inv.after'] as const).map((k) => <th key={k} className="px-5 py-3 text-start font-medium">{t(l, k)}</th>)}</tr>
            </thead>
            <tbody>
              {moves.data.items.map((m) => (
                <tr key={m.id} className="border-t border-slate-200/70" data-testid="movement-row">
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{fmt.format(new Date(m.createdAt))}</td>
                  <td className="px-5 py-3" dir="auto">{displayName(l, m.variant.product)}{optionText(m.variant.optionValues) ? ` · ${optionText(m.variant.optionValues)}` : ''}</td>
                  <td className="px-5 py-3">{t(l, `inv.r.${m.reason}` as Key)}</td>
                  <td className={`px-5 py-3 tabular-nums ${m.delta < 0 ? 'text-red-600' : 'text-emerald-700'}`} dir="ltr">{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                  <td className="px-5 py-3 tabular-nums">{m.quantityAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
