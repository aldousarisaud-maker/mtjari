import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Field, Input } from '@/components/ui';
import { registerAction } from '@/app/actions';
import { isLocale, t } from '@/lib/i18n';

export const metadata = { title: 'Create account' };

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">{t(l, 'auth.register.title')}</h1>
      <ActionForm action={registerAction}>
        <input type="hidden" name="locale" value={l} />
        <Field label={t(l, 'auth.name')} htmlFor="name"><Input id="name" name="name" autoComplete="name" required maxLength={120} /></Field>
        <Field label={t(l, 'auth.email')} htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" /></Field>
        <Field label={t(l, 'auth.password')} htmlFor="password" hint={t(l, 'auth.register.hint')}>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} dir="ltr" />
        </Field>
        <SubmitButton className="w-full">{t(l, 'auth.register.cta')}</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm text-slate-500">
        {t(l, 'auth.register.hasAccount')} <Link className="text-primary hover:underline" href={`/${l}/login`}>{t(l, 'nav.login')}</Link>
      </p>
    </>
  );
}
