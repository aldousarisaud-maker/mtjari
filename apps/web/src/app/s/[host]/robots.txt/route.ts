import { hostFromParam, shopApi, shopOrigin } from '@/storefront/api';
import type { Shop } from '@/storefront/types';

export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const host = hostFromParam((await params).host);
  const res = await shopApi<Shop>(host, '/store');
  if (!res.ok) return new Response('Not found', { status: 404 });
  const origin = await shopOrigin(host);
  // Previews, carts, checkout and order links are never crawled; everything else is public.
  const body = res.data.preview
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nDisallow: /ar/cart\nDisallow: /en/cart\nDisallow: /ar/checkout\nDisallow: /en/checkout\nDisallow: /ar/orders/\nDisallow: /en/orders/\n\nSitemap: ${origin}/sitemap.xml\n`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
