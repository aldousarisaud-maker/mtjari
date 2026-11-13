import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@mtjari/shared';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, t } from '@/lib/i18n';
import { can, getStore } from '../../data';
import { ProductDetailFields, editorLabels, type BrandOption, type CategoryOption } from '../product-fields';
import { NewProductForm } from './new-product-form';

export default async function NewProductPage({ params }: { params: Promise<{ locale: string; storeId: string }> }) {
  const { locale, storeId } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  if (!can(store, PERMISSIONS.PRODUCTS_WRITE)) notFound();
  const [cats, brands] = await Promise.all([api<CategoryOption[]>(`/v1/stores/${store.id}/categories`), api<BrandOption[]>(`/v1/stores/${store.id}/brands`)]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t(l, 'p.new')}</h1>
      <Card>
        <NewProductForm
          locale={l} storeId={store.id} currency={store.currency} labels={editorLabels(l)}
          typeLabels={{ SIMPLE: t(l, 'p.type.SIMPLE'), VARIANT: t(l, 'p.type.VARIANT'), DIGITAL: t(l, 'p.type.DIGITAL') }}
          text={{ type: t(l, 'p.type'), pricing: t(l, 'p.pricing'), create: t(l, 'p.create') }}
        >
          <ProductDetailFields locale={l} categories={cats.ok ? cats.data : []} brands={brands.ok ? brands.data : []} />
        </NewProductForm>
      </Card>
    </div>
  );
}
