import Link from 'next/link';
import { isLocale, t } from '@/lib/i18n';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> }) {
  const { locale } = await params;
  const { next } = await searchParams;
  const l = isLocale(locale) ? locale : 'ar';
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">{t(l, 'auth.login.title')}</h1>
      <LoginForm locale={l} next={typeof next === 'string' ? next : ''} labels={{ email: t(l, 'auth.email'), password: t(l, 'auth.password'), mfa: t(l, 'auth.mfa'), cta: t(l, 'auth.login.cta') }} />
      <div className="mt-6 flex justify-between text-sm">
        <Link className="text-primary hover:underline" href={`/${l}/forgot-password`}>{t(l, 'auth.forgot')}</Link>
        <span className="text-slate-500">
          {t(l, 'auth.login.noAccount')} <Link className="text-primary hover:underline" href={`/${l}/register`}>{t(l, 'nav.start')}</Link>
        </span>
      </div>
    </>
  );
}
