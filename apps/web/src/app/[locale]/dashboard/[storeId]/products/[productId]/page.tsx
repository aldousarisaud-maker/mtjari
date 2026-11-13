import { notFound } from 'next/navigation';
import { PERMISSIONS, fromMinor } from '@mtjari/shared';
import { deleteImageAction, deleteProductAction, updateProductAction, uploadImageAction } from '@/app/catalog-actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, t } from '@/lib/i18n';
import { can, getStore } from '../../data';
import { RowAction } from '../../row-action';
import { ProductDetailFields, displayName, editorLabels, type BrandOption, type CategoryOption } from '../product-fields';
import type { EditorVariant } from '../variant-editor';
import { VariantsForm } from './variants-form';

interface Variant {
  id: string; sku: string | null; barcode: string | null; optionValues: Record<string, string>; price: number; compareAtPrice: number | null;
  cost: number | null; trackInventory: boolean; stockQuantity: number; lowStockThreshold: number | null;
}
interface Product {
  id: string; type: 'SIMPLE' | 'VARIANT' | 'DIGITAL'; status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'; slug: string; nameAr: string | null; nameEn: string | null;
  descriptionAr: string | null; descriptionEn: string | null; brandId: string | null; tags: string[]; seoTitle: string | null; seoDescription: string | null;
  options: { name: string; values: string[] }[]; variants: Variant[]; categories: { id: string }[];
  media: { id: string; urls: Record<string, string>; width: number; height: number; altAr: string | null; altEn: string | null }[];
}

export default async function ProductPage({ params }: { params: Promise<{ locale: string; storeId: string; productId: string }> }) {
  const { locale, storeId, productId } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  if (!can(store, PERMISSIONS.PRODUCTS_READ) || !/^[0-9a-f-]{36}$/i.test(productId)) notFound();
  const [res, cats, brands] = await Promise.all([
    api<Product>(`/v1/stores/${store.id}/products/${productId}`),
    api<CategoryOption[]>(`/v1/stores/${store.id}/categories`),
    api<BrandOption[]>(`/v1/stores/${store.id}/brands`),
  ]);
  if (!res.ok) notFound();
  const p = res.data;
  const write = can(store, PERMISSIONS.PRODUCTS_WRITE);
  const money = (v: number | null) => (v == null ? '' : fromMinor(v, store.currency));
  const variants: EditorVariant[] = p.variants.map((v) => ({
    id: v.id, optionValues: v.optionValues, sku: v.sku ?? '', barcode: v.barcode ?? '', price: money(v.price), compareAtPrice: money(v.compareAtPrice),
    cost: money(v.cost), trackInventory: v.trackInventory, lowStockThreshold: v.lowStockThreshold?.toString() ?? '', initialStock: '', stockQuantity: v.stockQuantity,
  }));
  const hidden = { locale: l, storeId: store.id, productId: p.id };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{displayName(l, p)}</h1>
        <Badge>{t(l, `p.st.${p.status}`)}</Badge>
        <span className="text-sm text-slate-500">{t(l, `p.type.${p.type}`)}</span>
      </div>

      <fieldset disabled={!write} className="min-w-0 space-y-5">
        <Card>
          <h2 className="mb-4 text-lg font-semibold">{t(l, 'p.details')}</h2>
          <ActionForm action={updateProductAction}>
            {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <ProductDetailFields locale={l} withSlug categories={cats.ok ? cats.data : []} brands={brands.ok ? brands.data : []}
              values={{ ...p, categoryIds: p.categories.map((c) => c.id) }} />
            {write ? <SubmitButton>{t(l, 'p.save')}</SubmitButton> : null}
          </ActionForm>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold">{t(l, 'p.pricing')} <span className="text-sm font-normal text-slate-500" dir="ltr">({store.currency})</span></h2>
          <VariantsForm {...hidden} currency={store.currency} type={p.type} labels={editorLabels(l)} options={p.options} variants={variants} save={write ? t(l, 'p.saveVariants') : ''} />
        </Card>
      </fieldset>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">{t(l, 'p.images')}</h2>
        {p.media.length ? (
          <ul className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {p.media.map((m) => {
              const sizes = Object.keys(m.urls).map(Number).sort((a, b) => a - b);
              return (
                <li key={m.id} className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.urls[sizes[0]!]} srcSet={sizes.map((w) => `${m.urls[w]} ${w}w`).join(', ')} sizes="200px" width={m.width} height={m.height}
                    alt={(l === 'ar' ? m.altAr || m.altEn : m.altEn || m.altAr) ?? displayName(l, p)} loading="lazy" className="aspect-square w-full rounded-2xl border border-slate-200 object-cover" />
                  {write ? <RowAction action={deleteImageAction} fields={{ ...hidden, id: m.id }} label={t(l, 'p.image.delete')} variant="danger" /> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {write ? (
          <ActionForm action={uploadImageAction} className="max-w-md">
            {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <Field label={t(l, 'p.upload')} htmlFor="file" hint={t(l, 'p.image.hint')}>
              <input id="file" name="file" type="file" required accept="image/jpeg,image/png,image/webp,image/avif" className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-primary" />
            </Field>
            <Field label={t(l, 'p.alt')} htmlFor="alt"><Input id="alt" name="alt" maxLength={200} /></Field>
            <SubmitButton>{t(l, 'p.upload')}</SubmitButton>
          </ActionForm>
        ) : null}
      </Card>

      {write ? (
        <Card><RowAction action={deleteProductAction} fields={hidden} label={t(l, 'p.delete')} variant="danger" /></Card>
      ) : null}
    </div>
  );
}
