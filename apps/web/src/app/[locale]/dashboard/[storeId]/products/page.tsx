import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CSV_COLUMNS, PERMISSIONS, PRODUCT_STATUSES, formatMoney } from '@mtjari/shared';
import { Badge, Card, Input, Select, buttonClass } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, t, type Key } from '@/lib/i18n';
import { can, getStore } from '../data';
import { Pager } from '../pager';
import { ImportForm } from './import-form';
import { displayName } from './product-fields';

interface Item {
  id: string; nameAr: string | null; nameEn: string | null; type: string; status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'; brand: string | null;
  image: { urls: Record<string, string> } | null; priceMin: number; priceMax: number; variantCount: number; stock: number | null; lowStock: boolean;
}

export default async function ProductsPage({ params, searchParams }: { params: Promise<{ locale: string; storeId: string }>; searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { locale, storeId } = await params;
  const sp = await searchParams;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  if (!can(store, PERMISSIONS.PRODUCTS_READ)) notFound();
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 100) : '';
  const status = PRODUCT_STATUSES.find((s) => s === sp.status);
  const page = /^\d{1,4}$/.test(sp.page ?? '') ? Math.max(1, Number(sp.page)) : 1;
  const qs = new URLSearchParams({ page: String(page), limit: '20' });
  if (q) qs.set('q', q);
  if (status) qs.set('status', status);
  const res = await api<{ total: number; limit: number; items: Item[] }>(`/v1/stores/${store.id}/products?${qs}`);
  const items = res.ok ? res.data.items : [];
  const base = `/${l}/dashboard/${store.id}/products`;
  const write = can(store, PERMISSIONS.PRODUCTS_WRITE);
  const price = (p: Item) =>
    p.priceMin === p.priceMax ? formatMoney(p.priceMin, store.currency, l) : `${formatMoney(p.priceMin, store.currency, l)} – ${formatMoney(p.priceMax, store.currency, l)}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t(l, 'side.products')}</h1>
        <div className="flex flex-wrap gap-2">
          {/* A plain link: the route handler streams the CSV file from the API. */}
          <a href={`${base}/export`} className={buttonClass({ variant: 'ghost' })} download>{t(l, 'p.export')}</a>
          {write ? <Link href={`${base}/new`} className={buttonClass()}>{t(l, 'p.new')}</Link> : null}
        </div>
      </div>

      <form method="get" className="glass flex flex-wrap items-center gap-3 p-4" role="search">
        <Input name="q" type="search" defaultValue={q} placeholder={t(l, 'p.search')} aria-label={t(l, 'p.search')} className="min-w-48 flex-1" />
        <Select name="status" defaultValue={status ?? ''} aria-label={t(l, 'p.status')} className="w-44">
          <option value="">{t(l, 'p.all')}</option>
          {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{t(l, `p.st.${s}`)}</option>)}
        </Select>
        <button type="submit" className={buttonClass({ variant: 'ghost' })}>{t(l, 'p.filter')}</button>
      </form>

      <Card className="overflow-x-auto p-0">
        {items.length ? (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>{(['p.name', 'p.status', 'p.price', 'p.stock'] as const).map((k) => <th key={k} className="px-5 py-3 text-start font-medium">{t(l, k)}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const thumb = p.image ? p.image.urls[Object.keys(p.image.urls).map(Number).sort((a, b) => a - b)[0]!] : null;
                return (
                  <tr key={p.id} className="border-t border-slate-200/70">
                    <td className="px-5 py-3">
                      <Link href={`${base}/${p.id}`} className="flex items-center gap-3 font-medium hover:text-primary">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" width={44} height={44} loading="lazy" className="size-11 shrink-0 rounded-xl border border-slate-200 object-cover" />
                        ) : <span className="size-11 shrink-0 rounded-xl border border-dashed border-slate-300 bg-slate-100/60 dark:bg-slate-800/60" aria-hidden />}
                        <span className="min-w-0">
                          <span className="block truncate" dir="auto">{displayName(l, p)}</span>
                          <span className="block text-xs font-normal text-slate-500">
                            {p.brand ? `${p.brand} · ` : ''}{p.variantCount > 1 ? `${p.variantCount} ${t(l, 'p.variants')}` : t(l, `p.type.${p.type}` as Key)}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-3"><Badge className={p.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : p.status === 'ARCHIVED' ? 'bg-slate-200 text-slate-600' : ''}>{t(l, `p.st.${p.status}`)}</Badge></td>
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums">{price(p)}</td>
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums">
                      {p.stock === null ? <span className="text-slate-400">{t(l, 'p.untracked')}</span> : p.stock}
                      {p.lowStock ? <Badge className="ms-2 bg-amber-100 text-amber-700">{t(l, 'p.low')}</Badge> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="p-8 text-center text-sm text-slate-500">{t(l, 'p.empty')}</p>}
      </Card>

      {res.ok ? <Pager locale={l} base={base} page={page} total={res.data.total} limit={res.data.limit} query={{ q, status: status ?? '' }} /> : null}

      {write && can(store, PERMISSIONS.INVENTORY_WRITE) ? (
        <Card className="max-w-2xl">
          <h2 className="mb-1 text-lg font-semibold">{t(l, 'p.import')}</h2>
          <p className="mb-4 text-xs text-slate-500" dir="ltr">{CSV_COLUMNS.join(', ')}</p>
          <ImportForm locale={l} storeId={store.id} cta={t(l, 'p.import.cta')} rowLabel={t(l, 'p.import.row')} />
        </Card>
      ) : null}
    </div>
  );
}
