import { hostFromParam, shopApi, shopOrigin } from '@/storefront/api';

interface SitemapData { products: { slug: string; updatedAt: string }[]; categories: { slug: string; updatedAt: string }[] }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const host = hostFromParam((await params).host);
  const res = await shopApi<SitemapData>(host, '/sitemap');
  if (!res.ok) return new Response('Not found', { status: 404 });
  const origin = await shopOrigin(host);
  const paths: { path: string; lastmod?: string }[] = [
    { path: '' }, { path: '/products' },
    ...res.data.categories.map((c) => ({ path: `/c/${encodeURIComponent(c.slug)}`, lastmod: c.updatedAt })),
    ...res.data.products.map((p) => ({ path: `/p/${encodeURIComponent(p.slug)}`, lastmod: p.updatedAt })),
  ];
  // Each page is listed in both languages with hreflang alternates.
  const urls = paths.flatMap(({ path, lastmod }) =>
    (['ar', 'en'] as const).map((l) =>
      `<url><loc>${esc(`${origin}/${l}${path}`)}</loc>${lastmod ? `<lastmod>${esc(new Date(lastmod).toISOString())}</lastmod>` : ''}` +
      `<xhtml:link rel="alternate" hreflang="ar" href="${esc(`${origin}/ar${path}`)}"/><xhtml:link rel="alternate" hreflang="en" href="${esc(`${origin}/en${path}`)}"/></url>`,
    ),
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=900' } });
}
