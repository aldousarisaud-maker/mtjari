import type { Metadata, Viewport } from 'next';
import { pageContext, seo, type ShopParams } from '@/storefront/context';
import { heroText, themeVars } from '@/storefront/components';
import { storefrontFontVars } from '@/storefront/fonts';
import '../../storefront.css';

export async function generateMetadata({ params }: { params: ShopParams }): Promise<Metadata> {
  const { host, locale } = await params;
  const pc = await pageContext(host, locale);
  const { subtitle } = heroText(pc.ctx);
  return {
    ...seo(pc, ''),
    metadataBase: new URL(pc.origin),
    title: { default: pc.ctx.shop.name, template: `%s · ${pc.ctx.shop.name}` },
    description: subtitle || pc.ctx.shop.name,
    openGraph: { siteName: pc.ctx.shop.name, locale: pc.ctx.locale === 'ar' ? 'ar_KW' : 'en_US', type: 'website' },
  };
}

export async function generateViewport({ params }: { params: ShopParams }): Promise<Viewport> {
  const { host, locale } = await params;
  const { ctx } = await pageContext(host, locale);
  return { themeColor: ctx.shop.theme.settings.colors.primary, width: 'device-width', initialScale: 1 };
}

export default async function StorefrontLayout({ children, params }: { children: React.ReactNode; params: ShopParams }) {
  const { host, locale } = await params;
  const { ctx, theme } = await pageContext(host, locale);
  return (
    <html lang={ctx.locale} dir={ctx.locale === 'ar' ? 'rtl' : 'ltr'} className={storefrontFontVars}>
      <body className="antialiased">
        <div data-theme={theme.id} style={themeVars(ctx.shop.theme.settings.colors)} className={`${theme.root} flex min-h-dvh flex-col`}>
          <theme.Layout ctx={ctx}>{children}</theme.Layout>
          {ctx.shop.preview ? (
            <p role="status" className="sticky bottom-0 z-50 mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-amber-300 px-4 py-2 text-center text-sm font-medium text-black">
              {ctx.t('previewBanner')} <a href={`/${ctx.locale}?preview=off`} className="underline underline-offset-4">{ctx.t('exitPreview')}</a>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
