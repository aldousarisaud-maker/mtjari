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

// Hosts that serve the platform itself (landing page, dashboard). Every other host is a merchant's shop.
const ROOT_DOMAIN = (process.env.ROOT_DOMAIN ?? 'mtjari.cc').toLowerCase();
const PLATFORM_HOSTS = new Set(
  [ROOT_DOMAIN, `www.${ROOT_DOMAIN}`, 'localhost', '127.0.0.1', ...(process.env.PLATFORM_HOSTS ?? '').split(',')].map((h) => h.trim().toLowerCase()).filter(Boolean),
);
const PREVIEW_COOKIE = 'mtj_preview';

/**
 * Shop hosts ({slug}.ROOT_DOMAIN or a merchant's own domain) are rewritten to
 * the internal /s/{host}/... routes. The shop never sees dashboard cookies
 * logic, and the dashboard is never served on a shop host.
 */
function shopProxy(req: NextRequest, host: string) {
  const { pathname, searchParams } = req.nextUrl;
  // ?pv=<token>: the dashboard's embedded preview. The token rides in a request header only (no cookie: browsers drop
  // third-party cookies in iframes), and the API still verifies its signature, store and expiry.
  const pv = searchParams.get('pv');
  const hdrs = new Headers(req.headers);
  if (pv && /^[\w.-]{20,300}$/.test(pv)) hdrs.set('x-mtj-preview', pv);
  else hdrs.delete('x-mtj-preview');
  const internal = (path: string) => NextResponse.rewrite(new URL(`/s/${encodeURIComponent(host)}${path}${req.nextUrl.search}`, req.url), { request: { headers: hdrs } });
  if (pathname === '/robots.txt' || pathname === '/sitemap.xml') return internal(pathname);

  // ?preview=<token> from the dashboard: keep it in an httpOnly cookie and clean the URL.
  const preview = searchParams.get('preview');
  if (preview !== null) {
    const url = req.nextUrl.clone();
    url.searchParams.delete('preview');
    const res = NextResponse.redirect(url);
    if (preview === 'off' || !/^[\w.-]{20,300}$/.test(preview)) res.cookies.delete(PREVIEW_COOKIE);
    else res.cookies.set({ name: PREVIEW_COOKIE, value: preview, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 30 * 60 });
    return res;
  }

  const first = pathname.split('/')[1];
  if (!isLocale(first)) {
    const preferred = req.headers.get('accept-language')?.toLowerCase().startsWith('en') ? 'en' : DEFAULT_LOCALE;
    const url = req.nextUrl.clone();
    url.pathname = `/${preferred}${pathname === '/' ? '' : pathname}`;
    return NextResponse.redirect(url);
  }
  return internal(pathname);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = (req.headers.get('host') ?? '').replace(/:\d+$/, '').toLowerCase();
  // The internal shop routes are reachable only through the rewrite above.
  if (pathname === '/s' || pathname.startsWith('/s/')) return new NextResponse('Not found', { status: 404 });
  if (!PLATFORM_HOSTS.has(host)) return shopProxy(req, host);
  if (pathname === '/robots.txt' || pathname === '/sitemap.xml') return NextResponse.next();
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
  // Every request except Next's own assets, so internal /s/... routes can never be reached directly.
  matcher: ['/((?!_next/|favicon\\.ico$).*)'],
};
