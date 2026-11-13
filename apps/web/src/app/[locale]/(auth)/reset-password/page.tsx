import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Field, Input } from '@/components/ui';
import { resetAction } from '@/app/actions';
import { isLocale, t } from '@/lib/i18n';

export const metadata = { robots: { index: false }, referrer: 'no-referrer' as const };

export default async function ResetPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { locale } = await params;
  const { token } = await searchParams;
  const l = isLocale(locale) ? locale : 'ar';
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">{t(l, 'auth.reset.title')}</h1>
      <ActionForm action={resetAction}>
        <input type="hidden" name="locale" value={l} />
        <input type="hidden" name="token" value={typeof token === 'string' ? token : ''} />
        <Field label={t(l, 'auth.password')} htmlFor="password" hint={t(l, 'auth.register.hint')}>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} dir="ltr" />
        </Field>
        <SubmitButton className="w-full">{t(l, 'auth.reset.cta')}</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm"><Link className="text-primary hover:underline" href={`/${l}/login`}>{t(l, 'nav.login')}</Link></p>
    </>
  );
}
