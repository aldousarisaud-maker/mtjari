import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { acceptInvitationAction } from '@/app/actions';
import { isLocale, t } from '@/lib/i18n';

export const metadata = { robots: { index: false }, referrer: 'no-referrer' as const };

export default async function AcceptPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { locale } = await params;
  const { token } = await searchParams;
  const l = isLocale(locale) ? locale : 'ar';
  const tok = typeof token === 'string' ? token : '';
  const back = `/${l}/invitations/accept?token=${encodeURIComponent(tok)}`;
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">{l === 'ar' ? 'دعوة للانضمام إلى متجر' : 'Store invitation'}</h1>
      <ActionForm action={acceptInvitationAction}>
        <input type="hidden" name="locale" value={l} />
        <input type="hidden" name="token" value={tok} />
        <SubmitButton className="w-full">{l === 'ar' ? 'قبول الدعوة' : 'Accept invitation'}</SubmitButton>
      </ActionForm>
      <p className="mt-6 flex justify-center gap-4 text-sm">
        <Link className="text-primary hover:underline" href={`/${l}/login?next=${encodeURIComponent(back)}`}>{t(l, 'nav.login')}</Link>
        <Link className="text-primary hover:underline" href={`/${l}/register`}>{t(l, 'auth.register.cta')}</Link>
      </p>
    </>
  );
}
