import { BUSINESS_TYPES, GCC_COUNTRIES, GCC_CURRENCIES } from '@mtjari/shared';
import { Field, Input, Select } from '@/components/ui';
import { t, type Locale } from '@/lib/i18n';

const TYPE_AR: Record<(typeof BUSINESS_TYPES)[number], string> = {
  electronics: 'إلكترونيات', gaming: 'ألعاب الفيديو', fashion: 'أزياء', beauty: 'تجميل وعناية', perfume: 'عطور', jewelry: 'مجوهرات',
  coffee: 'قهوة', food: 'مطاعم ومنتجات غذائية', home: 'أثاث وديكور', mobile: 'هواتف وإكسسوارات', sports: 'رياضة', baby: 'أطفال',
  pets: 'مستلزمات الحيوانات', books: 'كتب', digital: 'منتجات رقمية', auto: 'إكسسوارات السيارات', flowers: 'زهور وهدايا', watches: 'ساعات',
  health: 'صحة وعناية', grocery: 'بقالة وسوبرماركت', handmade: 'منتجات يدوية', multi: 'متعدد الأقسام', other: 'أخرى',
};
const COUNTRY: Record<(typeof GCC_COUNTRIES)[number], [string, string]> = {
  KW: ['الكويت', 'Kuwait'], SA: ['السعودية', 'Saudi Arabia'], AE: ['الإمارات', 'United Arab Emirates'],
  BH: ['البحرين', 'Bahrain'], QA: ['قطر', 'Qatar'], OM: ['عُمان', 'Oman'],
};

export interface StoreValues { name?: string; businessType?: string; country?: string; currency?: string; defaultLocale?: string }

export function StoreFields({ locale: l, values = {} }: { locale: Locale; values?: StoreValues }) {
  return (
    <>
      <Field label={t(l, 'store.name')} htmlFor="name">
        <Input id="name" name="name" required minLength={2} maxLength={80} defaultValue={values.name} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t(l, 'store.type')} htmlFor="businessType">
          <Select id="businessType" name="businessType" defaultValue={values.businessType ?? 'other'}>
            {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{l === 'ar' ? TYPE_AR[b] : b[0]!.toUpperCase() + b.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label={t(l, 'store.country')} htmlFor="country">
          <Select id="country" name="country" defaultValue={values.country ?? 'KW'}>
            {GCC_COUNTRIES.map((c) => <option key={c} value={c}>{COUNTRY[c][l === 'ar' ? 0 : 1]}</option>)}
          </Select>
        </Field>
        <Field label={t(l, 'store.currency')} htmlFor="currency">
          <Select id="currency" name="currency" defaultValue={values.currency ?? 'KWD'}>
            {GCC_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label={t(l, 'store.locale')} htmlFor="defaultLocale">
          <Select id="defaultLocale" name="defaultLocale" defaultValue={values.defaultLocale ?? 'ar'}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </Select>
        </Field>
      </div>
    </>
  );
}
