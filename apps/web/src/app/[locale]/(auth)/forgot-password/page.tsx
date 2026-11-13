import { ActionForm, SubmitButton } from '@/components/action-form';
import { Field, Input } from '@/components/ui';
import { forgotAction } from '@/app/actions';
import { isLocale, t } from '@/lib/i18n';

export default async function ForgotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">{t(l, 'auth.forgot.title')}</h1>
      <ActionForm action={forgotAction}>
        <input type="hidden" name="locale" value={l} />
        <Field label={t(l, 'auth.email')} htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" /></Field>
        <SubmitButton className="w-full">{t(l, 'auth.forgot.cta')}</SubmitButton>
      </ActionForm>
    </>
  );
}
