import { createStoreAction } from '@/app/actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Card } from '@/components/ui';
import { requireMe } from '@/lib/api';
import { isLocale, t } from '@/lib/i18n';
import { StoreFields } from '../store-fields';
import { SlugField } from './slug-field';

export default async function NewStorePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  await requireMe(l);
  return (
    <Card className="rise mx-auto max-w-2xl p-7">
      <h1 className="mb-6 text-xl font-semibold">{t(l, 'dash.new')}</h1>
      <ActionForm action={createStoreAction}>
        <input type="hidden" name="locale" value={l} />
        <SlugField labels={{ label: t(l, 'store.slug'), ok: t(l, 'store.slug.ok'), taken: t(l, 'store.slug.taken'), reserved: t(l, 'store.slug.reserved'), format: t(l, 'store.slug.format') }} />
        <StoreFields locale={l} />
        <SubmitButton>{t(l, 'store.create')}</SubmitButton>
      </ActionForm>
    </Card>
  );
}
