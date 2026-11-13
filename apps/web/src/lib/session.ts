export const AT_COOKIE = 'mtj_at';
export const RT_COOKIE = 'mtj_rt';

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

const base = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

/** Tokens live only in httpOnly cookies: page JavaScript can never read them. */
export function tokenCookies(tokens: TokenPair) {
  return [
    // Expire the cookie slightly before the token so the proxy refreshes in time.
    { name: AT_COOKIE, value: tokens.accessToken, ...base, maxAge: Math.max(tokens.accessTokenExpiresIn - 30, 30) },
    { name: RT_COOKIE, value: tokens.refreshToken, ...base, expires: new Date(tokens.refreshTokenExpiresAt) },
  ];
}

export const API_URL = process.env.API_URL ?? 'http://localhost:4000';
