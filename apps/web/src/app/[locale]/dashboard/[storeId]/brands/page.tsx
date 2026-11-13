import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@mtjari/shared';
import { createBrandAction, deleteBrandAction } from '@/app/catalog-actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Card, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, t } from '@/lib/i18n';
import { can, getStore } from '../data';
import { RowAction } from '../row-action';

interface Brand { id: string; name: string; slug: string; productCount: number }

export default async function BrandsPage({ params }: { params: Promise<{ locale: string; storeId: string }> }) {
  const { locale, storeId } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  if (!can(store, PERMISSIONS.PRODUCTS_READ)) notFound();
  const res = await api<Brand[]>(`/v1/stores/${store.id}/brands`);
  const brands = res.ok ? res.data : [];
  const write = can(store, PERMISSIONS.PRODUCTS_WRITE);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t(l, 'side.brands')}</h1>
      <Card className="p-0">
        {brands.length ? (
          <ul>
            {brands.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 px-5 py-3 first:border-t-0">
                <div>
                  <p className="font-medium" dir="auto">{b.name}</p>
                  <p className="text-xs text-slate-500">{b.productCount} {t(l, 'c.count')}</p>
                </div>
                {write ? <RowAction action={deleteBrandAction} fields={{ locale: l, storeId: store.id, id: b.id }} label={t(l, 'c.delete')} variant="danger" /> : null}
              </li>
            ))}
          </ul>
        ) : <p className="p-8 text-center text-sm text-slate-500">{t(l, 'b.empty')}</p>}
      </Card>
      {write ? (
        <Card className="max-w-md">
          <ActionForm action={createBrandAction} key={brands.length}>
            <input type="hidden" name="locale" value={l} />
            <input type="hidden" name="storeId" value={store.id} />
            <Field label={t(l, 'b.name')} htmlFor="name"><Input id="name" name="name" required maxLength={120} dir="auto" /></Field>
            <SubmitButton>{t(l, 'b.create')}</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
