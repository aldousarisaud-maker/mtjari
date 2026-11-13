import Link from 'next/link';
import { ShieldCheck, Store, Users } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, buttonClass } from '@/components/ui';
import { isLocale, t } from '@/lib/i18n';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const other = locale === 'ar' ? 'en' : 'ar';
  const features = [
    { icon: Store, title: t(locale, 'home.f1.t'), body: t(locale, 'home.f1.d') },
    { icon: Users, title: t(locale, 'home.f2.t'), body: t(locale, 'home.f2.d') },
    { icon: ShieldCheck, title: t(locale, 'home.f3.t'), body: t(locale, 'home.f3.d') },
  ];
  return (
    <div className="mx-auto max-w-6xl px-5">
      <header className="glass sticky top-4 z-10 mt-4 flex items-center justify-between px-5 py-3">
        <Link href={`/${locale}`} className="text-lg font-bold text-primary">{t(locale, 'brand')}</Link>
        <nav className="flex items-center gap-2">
          <Link href={`/${other}`} className="px-3 text-sm text-slate-600 hover:text-primary" hrefLang={other}>{t(locale, 'nav.lang')}</Link>
          <Link href={`/${locale}/login`} className={buttonClass({ variant: 'ghost' })}>{t(locale, 'nav.login')}</Link>
          <Link href={`/${locale}/register`} className={buttonClass()}>{t(locale, 'nav.start')}</Link>
        </nav>
      </header>

      <main>
        <section className="rise mx-auto max-w-3xl py-20 text-center sm:py-28">
          <Badge>{t(locale, 'home.badge')}</Badge>
          <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-6xl sm:leading-[1.15]">{t(locale, 'home.title')}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">{t(locale, 'home.sub')}</p>
          <div className="mt-10 flex justify-center gap-3">
            <Link href={`/${locale}/register`} className={buttonClass()}>{t(locale, 'nav.start')}</Link>
            <Link href={`/${locale}/login`} className={buttonClass({ variant: 'ghost' })}>{t(locale, 'nav.login')}</Link>
          </div>
        </section>

        <section className="grid gap-5 pb-10 sm:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="rise transition-transform duration-300 hover:-translate-y-1">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span>
              <h2 className="mt-4 text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{body}</p>
            </Card>
          ))}
        </section>
        <p className="pb-16 text-center text-sm text-slate-500">{t(locale, 'home.status')}</p>
      </main>

      <footer className="border-t border-slate-200/70 py-8 text-center text-sm text-slate-500">© {new Date().getFullYear()} Mtjari.cc</footer>
    </div>
  );
}
