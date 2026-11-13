import { PRODUCT_STATUSES } from '@mtjari/shared';
import { Field, Input, Select } from '@/components/ui';
import { t, type Locale } from '@/lib/i18n';
import type { EditorLabels } from './variant-editor';

export interface CategoryOption { id: string; nameAr: string | null; nameEn: string | null; parentId?: string | null }
export interface BrandOption { id: string; name: string }
export interface DetailValues {
  nameAr?: string | null; nameEn?: string | null; descriptionAr?: string | null; descriptionEn?: string | null; status?: string;
  brandId?: string | null; categoryIds?: string[]; tags?: string[]; seoTitle?: string | null; seoDescription?: string | null; slug?: string;
}

export const displayName = (l: Locale, x: { nameAr: string | null; nameEn: string | null }) => (l === 'ar' ? x.nameAr || x.nameEn : x.nameEn || x.nameAr) ?? '';

export const editorLabels = (l: Locale): EditorLabels => ({
  sku: t(l, 'p.sku'), barcode: t(l, 'p.barcode'), price: t(l, 'p.price'), compare: t(l, 'p.compare'), cost: t(l, 'p.cost'), margin: t(l, 'p.margin'),
  track: t(l, 'p.track'), initial: t(l, 'p.initial'), threshold: t(l, 'p.threshold'), options: t(l, 'p.options'), optionName: t(l, 'p.option.name'),
  optionValues: t(l, 'p.option.values'), optionAdd: t(l, 'p.option.add'), generate: t(l, 'p.option.generate'), stock: t(l, 'p.stock'),
});

const area = 'min-h-24 w-full rounded-xl border border-slate-200 bg-white/80 px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15 dark:bg-slate-900/60 dark:border-slate-700';

export function ProductDetailFields({ locale: l, values = {}, categories, brands, withSlug }: { locale: Locale; values?: DetailValues; categories: CategoryOption[]; brands: BrandOption[]; withSlug?: boolean }) {
  const selected = new Set(values.categoryIds ?? []);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t(l, 'p.nameAr')} htmlFor="nameAr"><Input id="nameAr" name="nameAr" dir="rtl" maxLength={200} defaultValue={values.nameAr ?? ''} /></Field>
        <Field label={t(l, 'p.nameEn')} htmlFor="nameEn"><Input id="nameEn" name="nameEn" dir="ltr" maxLength={200} defaultValue={values.nameEn ?? ''} /></Field>
        <Field label={t(l, 'p.descAr')} htmlFor="descriptionAr"><textarea id="descriptionAr" name="descriptionAr" dir="rtl" maxLength={20000} className={area} defaultValue={values.descriptionAr ?? ''} /></Field>
        <Field label={t(l, 'p.descEn')} htmlFor="descriptionEn"><textarea id="descriptionEn" name="descriptionEn" dir="ltr" maxLength={20000} className={area} defaultValue={values.descriptionEn ?? ''} /></Field>
        <Field label={t(l, 'p.status')} htmlFor="status">
          <Select id="status" name="status" defaultValue={values.status ?? 'DRAFT'}>
            {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{t(l, `p.st.${s}`)}</option>)}
          </Select>
        </Field>
        <Field label={t(l, 'p.brand')} htmlFor="brandId">
          <Select id="brandId" name="brandId" defaultValue={values.brandId ?? ''}>
            <option value="">{t(l, 'p.none')}</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
      </div>
      {categories.length ? (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">{t(l, 'p.categories')}</legend>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                <input type="checkbox" name="categoryIds" value={c.id} defaultChecked={selected.has(c.id)} className="size-4 accent-[#2563EB]" />{displayName(l, c)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <Field label={t(l, 'p.tags')} htmlFor="tags"><Input id="tags" name="tags" defaultValue={(values.tags ?? []).join(', ')} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t(l, 'p.seoTitle')} htmlFor="seoTitle" hint="≤ 70"><Input id="seoTitle" name="seoTitle" maxLength={70} defaultValue={values.seoTitle ?? ''} /></Field>
        {withSlug ? <Field label={t(l, 'p.slug')} htmlFor="slug"><Input id="slug" name="slug" dir="auto" maxLength={96} defaultValue={values.slug ?? ''} /></Field> : null}
      </div>
      <Field label={t(l, 'p.seoDesc')} htmlFor="seoDescription" hint="≤ 170"><textarea id="seoDescription" name="seoDescription" maxLength={170} className={area.replace('min-h-24', 'min-h-16')} defaultValue={values.seoDescription ?? ''} /></Field>
    </>
  );
}
