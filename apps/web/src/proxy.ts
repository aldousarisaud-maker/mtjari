import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, isLocale } from './lib/i18n';
import { API_URL, AT_COOKIE, RT_COOKIE, tokenCookies, type TokenPair } from './lib/session';

/**
 * Single-flight refresh. Refresh tokens rotate and reuse revokes the whole
 * session family, so parallel requests (e.g. link prefetches) arriving with
 * the same expired access token must share one refresh call.
 * NOTE: in-process only. Run one web instance, or move this to Redis before
 * scaling the web tier horizontally (tracked in docs/IMPLEMENTATION_PLAN.md).
 */
const inflight = new Map<string, Promise<TokenPair | null>>();

function refreshOnce(refreshToken: string): Promise<TokenPair | null> {
  let p = inflight.get(refreshToken);
  if (!p) {
    p = fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    })
      .then(async (r) => (r.ok ? ((await r.json()) as TokenPair) : null))
      .catch(() => null);
    inflight.set(refreshToken, p);
    setTimeout(() => inflight.delete(refreshToken), 15_000).unref?.();
  }
  return p;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const first = pathname.split('/')[1];

  if (!isLocale(first)) {
    const preferred = req.headers.get('accept-language')?.toLowerCase().startsWith('en') ? 'en' : DEFAULT_LOCALE;
    const url = req.nextUrl.clone();
    url.pathname = `/${preferred}${pathname === '/' ? '' : pathname}`;
    return NextResponse.redirect(url);
  }

  const hasAccess = req.cookies.has(AT_COOKIE);
  const refreshToken = req.cookies.get(RT_COOKIE)?.value;
  if (!hasAccess && refreshToken) {
    const tokens = await refreshOnce(refreshToken);
    if (tokens) {
      // Make the new token visible to this request's server components...
      req.cookies.set(AT_COOKIE, tokens.accessToken);
      req.cookies.set(RT_COOKIE, tokens.refreshToken);
      const res = NextResponse.next({ request: { headers: req.headers } });
      // ...and persist it in the browser.
      for (const c of tokenCookies(tokens)) res.cookies.set(c);
      return res;
    }
    const res = pathname.includes('/dashboard')
      ? NextResponse.redirect(new URL(`/${first}/login`, req.url))
      : NextResponse.next();
    res.cookies.delete(RT_COOKIE);
    return res;
  }

  if (!hasAccess && pathname.includes('/dashboard')) {
    return NextResponse.redirect(new URL(`/${first}/login`, req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/|api/|favicon.ico|robots.txt|sitemap.xml|.*\\.[a-z0-9]+$).*)'],
};
