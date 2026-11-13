import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { PlatformRole } from '@mtjari/db';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  locale: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  platformRole: PlatformRole;
  sessionId: string;
}

export type AuthedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'mtjari:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRE_VERIFIED = 'mtjari:requireVerified';
/** Route requires a confirmed email address (e.g. creating a store). */
export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED, true);

export const AUTH_THROTTLE = 'mtjari:authThrottle';
/** Apply the stricter "auth" rate limit (login, register, reset...). */
export const AuthThrottle = () => SetMetadata(AUTH_THROTTLE, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a public route');
  return user;
});
