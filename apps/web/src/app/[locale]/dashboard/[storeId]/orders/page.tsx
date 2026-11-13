import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ORDER_STATUSES, PERMISSIONS, formatMoney } from '@mtjari/shared';
import { Badge, Card, Input, buttonClass } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, t } from '@/lib/i18n';
import { can, getStore } from '../data';
import { Pager } from '../pager';
import { payTone, statusTone } from './tones';

interface Row {
  id: string; number: number; status: (typeof ORDER_STATUSES)[number]; paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED'; fulfillment: 'DELIVERY' | 'PICKUP';
  currency: string; total: number; customerName: string; customerPhone: string; placedAt: string; itemCount: number;
}

export default async function OrdersPage({ params, searchParams }: { params: Promise<{ locale: string; storeId: string }>; searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { locale, storeId } = await params;
  const sp = await searchParams;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  if (!can(store, PERMISSIONS.ORDERS_READ)) notFound();
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 60) : '';
  const status = (ORDER_STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status! : '';
  const page = /^\d{1,4}$/.test(sp.page ?? '') ? Math.max(1, Number(sp.page)) : 1;
  const qs = new URLSearchParams({ page: String(page), limit: '20' });
  if (q) qs.set('q', q);
  if (status) qs.set('status', status);
  const res = await api<{ total: number; limit: number; items: Row[]; counts: Record<string, number> }>(`/v1/stores/${store.id}/orders?${qs}`);
  const items = res.ok ? res.data.items : [];
  const counts = res.ok ? res.data.counts : {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const base = `/${l}/dashboard/${store.id}/orders`;
  const fmt = new Intl.DateTimeFormat(l === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const tab = (value: string) => `${base}${value || q ? `?${new URLSearchParams({ ...(value ? { status: value } : {}), ...(q ? { q } : {}) })}` : ''}`;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t(l, 'o.title')}</h1>

      <nav className="flex flex-wrap gap-2" aria-label={t(l, 'o.status')}>
        <Link href={tab('')} aria-current={!status ? 'true' : undefined} className={buttonClass({ variant: !status ? 'primary' : 'ghost', size: 'sm' })}>{t(l, 'o.all')} ({all})</Link>
        {ORDER_STATUSES.map((s) => (
          <Link key={s} href={tab(s)} aria-current={status === s ? 'true' : undefined} className={buttonClass({ variant: status === s ? 'primary' : 'ghost', size: 'sm' })}>
            {t(l, `o.s.${s}`)} ({counts[s] ?? 0})
          </Link>
        ))}
      </nav>

      <form method="get" className="glass flex flex-wrap items-center gap-3 p-4" role="search">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <Input name="q" type="search" defaultValue={q} placeholder={t(l, 'o.search')} aria-label={t(l, 'o.search')} className="min-w-48 flex-1" />
        <button type="submit" className={buttonClass({ variant: 'ghost' })}>{t(l, 'p.filter')}</button>
      </form>

      <Card className="overflow-x-auto p-0">
        {items.length ? (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>{(['o.number', 'o.date', 'o.customer', 'o.total', 'o.status', 'o.payment'] as const).map((k) => <th key={k} className="px-5 py-3 text-start font-medium">{t(l, k)}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className="border-t border-slate-200/70" data-testid="order-row">
                  <td className="px-5 py-3"><Link href={`${base}/${o.id}`} className="font-semibold text-primary hover:underline" dir="ltr">#{o.number}</Link></td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{fmt.format(new Date(o.placedAt))}</td>
                  <td className="px-5 py-3"><span dir="auto">{o.customerName}</span><p className="text-xs text-slate-500" dir="ltr">{o.customerPhone}</p></td>
                  <td className="whitespace-nowrap px-5 py-3 tabular-nums">{formatMoney(o.total, o.currency, l)}</td>
                  <td className="px-5 py-3"><Badge className={statusTone(o.status)}>{t(l, `o.s.${o.status}`)}</Badge></td>
                  <td className="px-5 py-3"><Badge className={payTone(o.paymentStatus)}>{t(l, `o.p.${o.paymentStatus}`)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="p-8 text-center text-sm text-slate-500">{t(l, q || status ? 'o.emptyFiltered' : 'o.empty')}</p>}
      </Card>

      {res.ok ? <Pager locale={l} base={base} page={page} total={res.data.total} limit={res.data.limit} query={{ q, status }} /> : null}
    </div>
  );
}
