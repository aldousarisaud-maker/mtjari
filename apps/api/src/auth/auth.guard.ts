import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
import { IS_PUBLIC, REQUIRE_VERIFIED, type AuthedRequest } from './decorators';

interface AccessClaims {
  sub: string;
  sid: string;
}

/** Global guard: every route needs a valid access token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('missing_token');

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(header.slice(7));
    } catch {
      throw new UnauthorizedException('invalid_token');
    }

    // Revocation and suspension take effect immediately, not at token expiry.
    const session = await this.prisma.client.session.findUnique({
      where: { id: claims.sid },
      include: { user: true },
    });
    if (!session || session.userId !== claims.sub || session.revokedAt) throw new UnauthorizedException('session_revoked');
    if (session.user.status !== 'ACTIVE') throw new ForbiddenException('account_suspended');

    const u = session.user;
    req.user = {
      id: u.id,
      email: u.email,
      name: u.name,
      locale: u.locale,
      emailVerified: !!u.emailVerifiedAt,
      mfaEnabled: !!u.mfaEnabledAt,
      platformRole: u.platformRole,
      sessionId: session.id,
    };

    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED, targets) && !u.emailVerifiedAt) {
      throw new ForbiddenException('email_not_verified');
    }
    return true;
  }
}
