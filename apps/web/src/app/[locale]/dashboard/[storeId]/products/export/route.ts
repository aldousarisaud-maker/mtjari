import { cookies } from 'next/headers';
import { API_URL, AT_COOKIE } from '@/lib/session';

/** Streams the store's product CSV from the API using the session cookie (the token never reaches the browser's JS). */
export async function GET(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const token = (await cookies()).get(AT_COOKIE)?.value;
  if (!token || !/^[0-9a-f-]{36}$/i.test(storeId)) return new Response('Not found', { status: 404 });
  const res = await fetch(`${API_URL}/v1/stores/${storeId}/products/export`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) return new Response('Not found', { status: 404 });
  return new Response(res.body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="products.csv"',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
