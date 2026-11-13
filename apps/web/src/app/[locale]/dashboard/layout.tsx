import Link from 'next/link';
import { LogOut, ShieldCheck } from 'lucide-react';
import { logoutAction, resendVerificationAction } from '@/app/actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { requireMe } from '@/lib/api';
import { isLocale, t } from '@/lib/i18n';

export const metadata = { robots: { index: false } };

export default async function DashboardLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const me = await requireMe(l);
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16">
      <header className="glass sticky top-4 z-10 mt-4 flex items-center justify-between gap-3 px-5 py-3">
        <Link href={`/${l}/dashboard`} className="text-lg font-bold text-primary">{t(l, 'brand')}</Link>
        <div className="flex items-center gap-1 text-sm">
          <span className="hidden px-2 text-slate-500 sm:inline" dir="ltr">{me.user.email}</span>
          <Link href={`/${l}/dashboard/security`} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-slate-600 hover:bg-white/70 hover:text-primary">
            <ShieldCheck className="size-4" aria-hidden /> <span className="hidden sm:inline">{t(l, 'side.security')}</span>
          </Link>
          <form action={logoutAction}>
            <input type="hidden" name="locale" value={l} />
            <button className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-slate-600 hover:bg-white/70 hover:text-red-600">
              <LogOut className="size-4 rtl:-scale-x-100" aria-hidden /> <span className="hidden sm:inline">{t(l, 'nav.logout')}</span>
            </button>
          </form>
        </div>
      </header>

      {!me.user.emailVerified ? (
        <div className="glass mt-4 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/80 px-5 py-3 text-sm text-amber-900">
          <span>{t(l, 'auth.verify.banner')}</span>
          <ActionForm action={resendVerificationAction} className="flex items-center gap-3 space-y-0">
            <input type="hidden" name="locale" value={l} />
            <input type="hidden" name="email" value={me.user.email} />
            <SubmitButton size="sm" variant="ghost">{t(l, 'auth.verify.resend')}</SubmitButton>
          </ActionForm>
        </div>
      ) : null}

      <div className="mt-6">{children}</div>
    </div>
  );
}
