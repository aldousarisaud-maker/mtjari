import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PERMISSIONS, formatMoney, type OrderStatusName } from '@mtjari/shared';
import { addOrderNoteAction, recordPaymentAction, transitionOrderAction } from '@/app/order-actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, t, type Key } from '@/lib/i18n';
import { can, getStore } from '../../data';
import { displayName } from '../../products/product-fields';
import { payTone, statusTone } from '../tones';

interface Order {
  id: string; number: number; status: OrderStatusName; paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED'; paymentProvider: string; paymentName: { ar: string; en: string };
  fulfillment: 'DELIVERY' | 'PICKUP'; currency: string; subtotal: number; deliveryFee: number; total: number;
  customerName: string; customerPhone: string; customerEmail: string | null; customerNote: string | null; placedAt: string;
  address: null | { area: string; block: string; street: string; avenue: string; building: string; floor: string; apartment: string; directions: string; zoneNameAr: string; zoneNameEn: string };
  items: { id: string; nameAr: string | null; nameEn: string | null; sku: string | null; optionValues: Record<string, string>; unitPrice: number; quantity: number; lineTotal: number }[];
  events: { id: string; type: string; toStatus: OrderStatusName | null; note: string | null; actorName: string | null; createdAt: string }[];
  allowedTransitions: OrderStatusName[]; canRecordPayment: boolean;
}

export default async function OrderPage({ params }: { params: Promise<{ locale: string; storeId: string; orderId: string }> }) {
  const { locale, storeId, orderId } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  if (!can(store, PERMISSIONS.ORDERS_READ) || !/^[0-9a-f-]{36}$/i.test(orderId)) notFound();
  const res = await api<Order>(`/v1/stores/${store.id}/orders/${orderId}`);
  if (!res.ok) notFound();
  const o = res.data;
  const write = can(store, PERMISSIONS.ORDERS_WRITE);
  const money = (n: number) => formatMoney(n, o.currency, l);
  const fmt = new Intl.DateTimeFormat(l === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const hidden = { locale: l, storeId: store.id, orderId: o.id };
  const Hidden = () => <>{Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;
  const toLabel = (s: OrderStatusName): Key => (s === 'SHIPPED' && o.fulfillment === 'PICKUP' ? 'o.to.SHIPPED_PICKUP' : (`o.to.${s}` as Key));
  const forward = o.allowedTransitions.filter((s) => s !== 'CANCELLED');
  const a = o.address;
  const online = !o.canRecordPayment && o.paymentStatus === 'UNPAID' && o.status !== 'CANCELLED';

  return (
    <div className="space-y-5">
      <Link href={`/${l}/dashboard/${store.id}/orders`} className="text-sm text-slate-500 hover:text-primary">← {t(l, 'o.back')}</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t(l, 'o.order')} <span dir="ltr">#{o.number}</span></h1>
        <Badge className={statusTone(o.status)} data-testid="order-status">{t(l, `o.s.${o.status}`)}</Badge>
        <Badge className={payTone(o.paymentStatus)} data-testid="payment-status">{t(l, `o.p.${o.paymentStatus}`)}</Badge>
        <span className="text-sm text-slate-500">{fmt.format(new Date(o.placedAt))}</span>
      </div>
      {o.status === 'CANCELLED' && o.paymentStatus === 'PAID' ? <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t(l, 'o.paidCancelled')}</p> : null}

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-5">
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr>{(['o.items', 'p.sku', 'o.price', 'o.qty', 'o.total'] as const).map((k) => <th key={k} className="px-5 py-3 text-start font-medium">{t(l, k)}</th>)}</tr>
              </thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.id} className="border-t border-slate-200/70" data-testid="order-item">
                    <td className="px-5 py-3"><span dir="auto">{displayName(l, i)}</span>{Object.values(i.optionValues).length ? <p className="text-xs text-slate-500" dir="auto">{Object.values(i.optionValues).join(' / ')}</p> : null}</td>
                    <td className="px-5 py-3 font-mono text-xs" dir="ltr">{i.sku ?? '—'}</td>
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums">{money(i.unitPrice)}</td>
                    <td className="px-5 py-3 tabular-nums">{i.quantity}</td>
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums">{money(i.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="space-y-1.5 border-t border-slate-200/70 p-5 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t(l, 'o.subtotal')}</dt><dd className="tabular-nums">{money(o.subtotal)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t(l, 'o.deliveryFee')}</dt><dd className="tabular-nums">{money(o.deliveryFee)}</dd></div>
              <div className="flex justify-between gap-4 text-base font-semibold"><dt>{t(l, 'o.total')}</dt><dd className="tabular-nums" data-testid="order-total">{money(o.total)}</dd></div>
            </dl>
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold">{t(l, 'o.timeline')}</h2>
            <ol className="space-y-3 text-sm">
              {o.events.map((e) => (
                <li key={e.id} className="border-s-2 border-primary/30 ps-4" data-testid="order-event">
                  <p>
                    {t(l, (`o.e.${e.type}` as Key))}
                    {e.type === 'status' && e.toStatus ? <> <strong>{t(l, `o.s.${e.toStatus}`)}</strong></> : null}
                    {e.note ? <span dir="auto">{e.type === 'note' ? ': ' : ' · '}{e.note}</span> : null}
                  </p>
                  <p className="text-xs text-slate-500">{fmt.format(new Date(e.createdAt))}{e.actorName ? ` · ${e.actorName}` : ''}</p>
                </li>
              ))}
            </ol>
            {write ? (
              <ActionForm action={addOrderNoteAction} className="mt-5 flex flex-wrap items-start gap-2 space-y-0">
                <Hidden />
                <Input name="note" required maxLength={500} placeholder={t(l, 'o.addNote')} aria-label={t(l, 'o.addNote')} className="min-w-48 flex-1" />
                <SubmitButton variant="ghost">{t(l, 'o.save')}</SubmitButton>
              </ActionForm>
            ) : null}
          </Card>
        </div>

        <div className="space-y-5">
          {write ? (
            <Card className="space-y-4" data-testid="order-actions">
              <h2 className="text-lg font-semibold">{t(l, 'o.nextStep')}</h2>
              {forward.map((s) => (
                <ActionForm key={s} action={transitionOrderAction}>
                  <Hidden /><input type="hidden" name="to" value={s} />
                  <SubmitButton className="w-full">{t(l, toLabel(s))}</SubmitButton>
                </ActionForm>
              ))}
              {o.canRecordPayment ? (
                <ActionForm action={recordPaymentAction}>
                  <Hidden />
                  <SubmitButton variant="ghost" className="w-full">{t(l, 'o.recordCash')}</SubmitButton>
                  <p className="text-xs text-slate-500">{t(l, 'o.recordCashHint')}</p>
                </ActionForm>
              ) : null}
              {online ? <p className="text-xs text-slate-500">{t(l, 'o.onlineOnly')}</p> : null}
              {o.allowedTransitions.includes('CANCELLED') ? (
                <ActionForm action={transitionOrderAction}>
                  <Hidden /><input type="hidden" name="to" value="CANCELLED" />
                  <Input name="note" maxLength={500} placeholder={t(l, 'o.noteOptional')} aria-label={t(l, 'o.noteOptional')} />
                  <SubmitButton variant="danger" className="w-full">{t(l, 'o.to.CANCELLED')}</SubmitButton>
                </ActionForm>
              ) : null}
              {!o.allowedTransitions.length && !o.canRecordPayment ? <p className="text-sm text-slate-500">{t(l, 'o.final')}</p> : null}
            </Card>
          ) : null}

          <Card className="space-y-3 text-sm">
            <h2 className="text-lg font-semibold">{t(l, 'o.customer')}</h2>
            <p dir="auto">{o.customerName}</p>
            <p><a href={`tel:${o.customerPhone}`} dir="ltr" className="text-primary hover:underline">{o.customerPhone}</a></p>
            {o.customerEmail ? <p dir="ltr" className="break-all">{o.customerEmail}</p> : null}
            <h3 className="pt-2 font-semibold">{t(l, a ? 'o.address' : 'o.pickup')}</h3>
            {a ? (
              <p dir="auto" data-testid="order-address">
                {l === 'ar' ? a.zoneNameAr : a.zoneNameEn}، {a.area}، {t(l, 'o.block')} {a.block}، {a.street}{a.avenue ? `، ${a.avenue}` : ''}، {a.building}
                {a.floor ? `، ${a.floor}` : ''}{a.apartment ? `، ${a.apartment}` : ''}{a.directions ? ` (${a.directions})` : ''}
              </p>
            ) : null}
            {o.customerNote ? <><h3 className="pt-2 font-semibold">{t(l, 'o.customerNote')}</h3><p dir="auto">{o.customerNote}</p></> : null}
            <h3 className="pt-2 font-semibold">{t(l, 'o.payment')}</h3>
            <p>{o.paymentName[l]}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
