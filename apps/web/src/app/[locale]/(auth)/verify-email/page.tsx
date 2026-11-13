import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { verifyEmailAction } from '@/app/actions';
import { isLocale, t } from '@/lib/i18n';

export const metadata = { robots: { index: false }, referrer: 'no-referrer' as const };

// Confirmation needs a click (POST): mail scanners that pre-open links
// cannot burn the single-use token.
export default async function VerifyPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { locale } = await params;
  const { token } = await searchParams;
  const l = isLocale(locale) ? locale : 'ar';
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">{l === 'ar' ? 'تأكيد البريد الإلكتروني' : 'Confirm your email'}</h1>
      <ActionForm action={verifyEmailAction}>
        <input type="hidden" name="locale" value={l} />
        <input type="hidden" name="token" value={typeof token === 'string' ? token : ''} />
        <SubmitButton className="w-full">{l === 'ar' ? 'تأكيد البريد' : 'Confirm email'}</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm"><Link className="text-primary hover:underline" href={`/${l}/dashboard`}>{t(l, 'nav.dashboard')}</Link></p>
    </>
  );
}
