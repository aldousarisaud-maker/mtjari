import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { isThemeId, type ThemeId } from '@mtjari/shared';
import { safeEqual } from '../common/crypto';
import { ENV, type Env } from '../config/env';

export const PREVIEW_TTL_SECONDS = 30 * 60;

/**
 * Short-lived signed tokens that let a store member see the storefront before
 * launch and with unpublished theme settings. The token names one store and
 * one theme; it grants nothing else (no dashboard or API access).
 */
@Injectable()
export class PreviewTokens {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    // Derived key: a preview token can never be confused with an access token.
    this.key = createHmac('sha256', env.JWT_ACCESS_SECRET).update('mtjari:storefront-preview:v1').digest();
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }

  issue(storeId: string, themeId: ThemeId, now = Date.now()): { token: string; expiresAt: Date } {
    const exp = Math.floor(now / 1000) + PREVIEW_TTL_SECONDS;
    const payload = `${storeId}.${themeId}.${exp}`;
    return { token: `${Buffer.from(payload).toString('base64url')}.${this.sign(payload)}`, expiresAt: new Date(exp * 1000) };
  }

  /** Returns the theme to preview when the token is valid for this store, otherwise null. */
  verify(token: unknown, storeId: string, now = Date.now()): ThemeId | null {
    if (typeof token !== 'string' || token.length > 300) return null;
    const [body, sig, extra] = token.split('.');
    if (!body || !sig || extra !== undefined) return null;
    const payload = Buffer.from(body, 'base64url').toString('utf8');
    if (!safeEqual(this.sign(payload), sig)) return null;
    const [tokenStore, themeId, exp] = payload.split('.');
    if (tokenStore !== storeId || !isThemeId(themeId) || !/^\d+$/.test(exp ?? '') || Number(exp) * 1000 < now) return null;
    return themeId;
  }
}
