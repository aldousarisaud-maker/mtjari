import Link from 'next/link';
import { PERMISSIONS } from '@mtjari/shared';
import { updateStoreAction } from '@/app/actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, roleLabel, statusLabel, t } from '@/lib/i18n';
import { StoreFields } from '../store-fields';
import { can, getStore } from './data';

export default async function StoreOverview({ params }: { params: Promise<{ locale: string; storeId: string }> }) {
  const { locale, storeId } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  const primary = store.domains.find((d) => d.isPrimary) ?? store.domains[0];
  const facts = [
    [t(l, 'store.status'), statusLabel(l, store.status)],
    [t(l, 'store.domain'), primary?.hostname ?? '—'],
    [t(l, 'store.role'), store.access.roleKey ? roleLabel(l, { key: store.access.roleKey, name: store.access.roleKey }) : '—'],
    [t(l, 'store.currency'), store.currency],
  ] as const;
  const summary = can(store, PERMISSIONS.PRODUCTS_READ)
    ? await api<{ products: number; active: number; lowStock: number; outOfStock: number }>(`/v1/stores/${store.id}/catalog/summary`)
    : null;
  const base = `/${l}/dashboard/${store.id}`;
  const stats = summary?.ok
    ? ([
        ['cat.sum.products', summary.data.products, `${base}/products`],
        ['cat.sum.active', summary.data.active, `${base}/products?status=ACTIVE`],
        ['cat.sum.low', summary.data.lowStock, `${base}/inventory?low=1`],
        ['cat.sum.out', summary.data.outOfStock, `${base}/inventory`],
      ] as const)
    : [];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{store.name}</h1>
      {stats.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="catalog-summary">
          {stats.map(([k, v, href]) => (
            <Link key={k} href={href} className="glass block p-5 transition hover:-translate-y-0.5">
              <p className="text-xs text-slate-500">{t(l, k)}</p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums">{v}</p>
            </Link>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {facts.map(([k, v]) => (
          <Card key={k} className="p-5">
            <p className="text-xs text-slate-500">{k}</p>
            <p className="mt-1.5 truncate font-semibold" dir="auto">{v}</p>
          </Card>
        ))}
      </div>
      {can(store, PERMISSIONS.STORE_UPDATE) ? (
        <Card className="max-w-2xl">
          <ActionForm action={updateStoreAction}>
            <input type="hidden" name="locale" value={l} />
            <input type="hidden" name="storeId" value={store.id} />
            <StoreFields locale={l} values={store} />
            <SubmitButton>{t(l, 'store.save')}</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
