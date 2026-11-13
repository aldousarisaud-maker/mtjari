import Link from 'next/link';
import { isLocale, t } from '@/lib/i18n';
import { Card } from '@/components/ui';

export default async function AuthLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="rise w-full max-w-md">
        <Link href={`/${l}`} className="mb-6 block text-center text-2xl font-bold text-primary">{t(l, 'brand')}</Link>
        <Card className="p-7">{children}</Card>
      </div>
    </main>
  );
}
