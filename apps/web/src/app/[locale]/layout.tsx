import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic, Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { LOCALES, dirOf, isLocale, t } from '@/lib/i18n';
import '../globals.css';

const plex = IBM_Plex_Sans_Arabic({ subsets: ['arabic'], weight: ['400', '500', '600', '700'], variable: '--font-plex-arabic', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const viewport: Viewport = { themeColor: '#2563EB', width: 'device-width', initialScale: 1 };

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return {
    title: { default: `${t(locale, 'brand')} — ${t(locale, 'home.badge')}`, template: `%s · ${t(locale, 'brand')}` },
    description: t(locale, 'home.sub'),
    alternates: { languages: { ar: '/ar', en: '/en' } },
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} dir={dirOf(locale)} className={`${plex.variable} ${inter.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
