import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_URL, AT_COOKIE, RT_COOKIE, tokenCookies, type TokenPair } from './session';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
  /** Machine-readable error code from the API (e.g. "invalid_credentials"). */
  code?: string;
}

async function forwardHeaders(): Promise<Record<string, string>> {
  const h = await headers();
  const out: Record<string, string> = {};
  // Preserve the real client IP for the API's rate limiting and audit log.
  const xff = h.get('x-forwarded-for');
  if (xff) out['x-forwarded-for'] = xff;
  const ua = h.get('user-agent');
  if (ua) out['user-agent'] = ua;
  return out;
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData; auth?: boolean } = {},
): Promise<ApiResult<T>> {
  const hdrs: Record<string, string> = { ...(await forwardHeaders()) };
  if (opts.body !== undefined) hdrs['content-type'] = 'application/json';
  if (opts.auth !== false) {
    const token = (await cookies()).get(AT_COOKIE)?.value;
    if (token) hdrs.authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers: hdrs,
      // `form` is sent as multipart (fetch sets the boundary header itself).
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 503, data: null as T, code: 'generic' };
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  const body = data as { error?: string; message?: string } | null;
  const code = res.ok ? undefined : body?.error === 'mfa_required' ? 'mfa_required' : typeof body?.message === 'string' ? body.message : body?.error;
  return { ok: res.ok, status: res.status, data: data as T, code };
}

export async function setSession(tokens: TokenPair): Promise<void> {
  const jar = await cookies();
  for (const c of tokenCookies(tokens)) jar.set(c);
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(AT_COOKIE);
  jar.delete(RT_COOKIE);
}

export interface Me {
  user: { id: string; email: string; name: string; locale: string; emailVerified: boolean; mfaEnabled: boolean };
  stores: { id: string; name: string; slug: string; status: string; role: { id: string; key: string | null; name: string } }[];
}

/** For pages that need a signed-in user. Redirects to login otherwise. */
export async function requireMe(locale: string): Promise<Me> {
  const res = await api<Me>('/v1/me');
  if (!res.ok) redirect(`/${locale}/login`);
  return res.data;
}
