import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  forgotPasswordSchema, loginSchema, mfaCodeSchema, mfaDisableSchema, refreshSchema, registerSchema,
  resendVerificationSchema, resetPasswordSchema, verifyEmailSchema,
  type LoginInput, type RegisterInput,
} from '@mtjari/shared';
import { ZodPipe } from '../common/zod.pipe';
import { Meta, type RequestMeta } from '../common/request-meta';
import { PrismaService } from '../common/prisma.service';
import { AuthService, publicUser } from './auth.service';
import { AuthThrottle, CurrentUser, Public, type AuthUser } from './decorators';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @AuthThrottle() @Post('register')
  register(@Body(new ZodPipe(registerSchema)) body: RegisterInput, @Meta() meta: RequestMeta) {
    return this.auth.register(body, meta);
  }

  @Public() @AuthThrottle() @Post('verify-email') @HttpCode(200)
  verifyEmail(@Body(new ZodPipe(verifyEmailSchema)) body: { token: string }, @Meta() meta: RequestMeta) {
    return this.auth.verifyEmail(body.token, meta);
  }

  @Public() @AuthThrottle() @Post('resend-verification') @HttpCode(200)
  resend(@Body(new ZodPipe(resendVerificationSchema)) body: { email: string }) {
    return this.auth.resendVerification(body.email);
  }

  @Public() @AuthThrottle() @Post('login') @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Meta() meta: RequestMeta) {
    return this.auth.login(body, meta);
  }

  @Public() @Post('refresh') @HttpCode(200)
  refresh(@Body(new ZodPipe(refreshSchema)) body: { refreshToken: string }, @Meta() meta: RequestMeta) {
    return this.auth.refresh(body.refreshToken, meta);
  }

  @Post('logout') @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Meta() meta: RequestMeta) {
    await this.auth.logout(user, meta);
  }

  @Post('logout-all') @HttpCode(200)
  logoutAll(@CurrentUser() user: AuthUser, @Meta() meta: RequestMeta) {
    return this.auth.logoutAll(user, meta);
  }

  @Public() @AuthThrottle() @Post('forgot-password') @HttpCode(200)
  forgot(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }, @Meta() meta: RequestMeta) {
    return this.auth.forgotPassword(body.email, meta);
  }

  @Public() @AuthThrottle() @Post('reset-password') @HttpCode(200)
  reset(@Body(new ZodPipe(resetPasswordSchema)) body: { token: string; password: string }, @Meta() meta: RequestMeta) {
    return this.auth.resetPassword(body.token, body.password, meta);
  }

  @Post('mfa/setup') @HttpCode(200)
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.auth.mfaSetup(user);
  }

  @AuthThrottle() @Post('mfa/enable') @HttpCode(200)
  mfaEnable(@CurrentUser() user: AuthUser, @Body(new ZodPipe(mfaCodeSchema)) body: { code: string }, @Meta() meta: RequestMeta) {
    return this.auth.mfaEnable(user, body.code, meta);
  }

  @AuthThrottle() @Post('mfa/disable') @HttpCode(200)
  mfaDisable(@CurrentUser() user: AuthUser, @Body(new ZodPipe(mfaDisableSchema)) body: { code: string; password: string }, @Meta() meta: RequestMeta) {
    return this.auth.mfaDisable(user, body.code, body.password, meta);
  }
}

@Controller('v1/me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  /** Profile plus every store the user belongs to (RLS exposes only their own memberships). */
  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.client.user.findUniqueOrThrow({ where: { id: user.id } });
    const memberships = await this.prisma.tx({ userId: user.id }, (tx) =>
      tx.membership.findMany({
        where: { userId: user.id, status: 'ACTIVE', store: { deletedAt: null } },
        include: { store: { select: { id: true, name: true, slug: true, status: true } }, role: { select: { id: true, key: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return {
      user: publicUser(u),
      stores: memberships.map((m) => ({ ...m.store, role: m.role })),
    };
  }
}
