import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@mtjari/shared';
import { createCategoryAction, deleteCategoryAction } from '@/app/catalog-actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Card, Field, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, t } from '@/lib/i18n';
import { can, getStore } from '../data';
import { displayName } from '../products/product-fields';
import { RowAction } from '../row-action';

interface Category { id: string; nameAr: string | null; nameEn: string | null; slug: string; parentId: string | null; productCount: number }

/** Depth-first order so children are listed under their parent. */
function tree(all: Category[]): { c: Category; depth: number }[] {
  const out: { c: Category; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of all.filter((x) => x.parentId === parentId)) {
      out.push({ c, depth });
      if (depth < 10) walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default async function CategoriesPage({ params }: { params: Promise<{ locale: string; storeId: string }> }) {
  const { locale, storeId } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  if (!can(store, PERMISSIONS.PRODUCTS_READ)) notFound();
  const res = await api<Category[]>(`/v1/stores/${store.id}/categories`);
  const rows = tree(res.ok ? res.data : []);
  const write = can(store, PERMISSIONS.PRODUCTS_WRITE);
  const hidden = { locale: l, storeId: store.id };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t(l, 'side.categories')}</h1>
      <Card className="p-0">
        {rows.length ? (
          <ul>
            {rows.map(({ c, depth }) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 px-5 py-3 first:border-t-0">
                <div style={{ paddingInlineStart: `${depth * 1.5}rem` }}>
                  <p className="font-medium" dir="auto">{displayName(l, c)}</p>
                  <p className="text-xs text-slate-500"><span dir="ltr">/{c.slug}</span> · {c.productCount} {t(l, 'c.count')}</p>
                </div>
                {write ? <RowAction action={deleteCategoryAction} fields={{ ...hidden, id: c.id }} label={t(l, 'c.delete')} variant="danger" /> : null}
              </li>
            ))}
          </ul>
        ) : <p className="p-8 text-center text-sm text-slate-500">{t(l, 'c.empty')}</p>}
      </Card>
      {write ? (
        <Card className="max-w-2xl">
          <h2 className="mb-4 text-lg font-semibold">{t(l, 'c.new')}</h2>
          <ActionForm action={createCategoryAction} key={rows.length}>
            <input type="hidden" name="locale" value={l} />
            <input type="hidden" name="storeId" value={store.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t(l, 'p.nameAr')} htmlFor="nameAr"><Input id="nameAr" name="nameAr" dir="rtl" maxLength={120} /></Field>
              <Field label={t(l, 'p.nameEn')} htmlFor="nameEn"><Input id="nameEn" name="nameEn" dir="ltr" maxLength={120} /></Field>
            </div>
            <Field label={t(l, 'c.parent')} htmlFor="parentId">
              <Select id="parentId" name="parentId" defaultValue="">
                <option value="">{t(l, 'p.none')}</option>
                {rows.map(({ c, depth }) => <option key={c.id} value={c.id}>{'— '.repeat(depth)}{displayName(l, c)}</option>)}
              </Select>
            </Field>
            <SubmitButton>{t(l, 'c.create')}</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
