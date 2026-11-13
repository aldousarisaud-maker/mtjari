import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { EmailTokenType, User } from '@mtjari/db';
import type { LoginInput, RegisterInput } from '@mtjari/shared';
import { ENV, type Env } from '../config/env';
import { randomToken, sha256 } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { TokensService, type TokenPair } from './tokens.service';
import type { AuthUser } from './decorators';

const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 3600_000;
const asLocale = (l: string): 'ar' | 'en' => (l === 'en' ? 'en' : 'ar');

export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    locale: u.locale,
    emailVerified: !!u.emailVerifiedAt,
    mfaEnabled: !!u.mfaEnabledAt,
    platformRole: u.platformRole,
    createdAt: u.createdAt,
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly mfa: MfaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private async issueEmailToken(userId: string, type: EmailTokenType, ttlMs: number): Promise<string> {
    const token = randomToken(32);
    await this.db.$transaction([
      // Only the latest link of each type stays valid.
      this.db.emailToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } }),
      this.db.emailToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) } }),
    ]);
    return token;
  }

  private async consumeEmailToken(token: string, type: EmailTokenType): Promise<string> {
    const hash = sha256(token);
    const rec = await this.db.emailToken.findUnique({ where: { tokenHash: hash } });
    if (!rec || rec.type !== type || rec.usedAt || rec.expiresAt <= new Date()) {
      throw new BadRequestException('invalid_or_expired_token');
    }
    const claimed = await this.db.emailToken.updateMany({ where: { id: rec.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new BadRequestException('invalid_or_expired_token');
    return rec.userId;
  }

  /** Always answers the same way so the endpoint can't be used to discover accounts. */
  async register(input: RegisterInput, meta: RequestMeta): Promise<{ status: 'verification_sent' }> {
    const existing = await this.db.user.findUnique({ where: { email: input.email } });
    if (existing) {
      await this.mail.sendAccountExists(existing.email, asLocale(existing.locale));
      await this.audit.recordPlatform({ actorUserId: existing.id, action: 'auth.register.duplicate', meta });
      return { status: 'verification_sent' };
    }
    const passwordHash = await this.passwords.hash(input.password);
    let user: User;
    try {
      user = await this.db.user.create({ data: { email: input.email, name: input.name, locale: input.locale, passwordHash } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { status: 'verification_sent' };
      throw e;
    }
    const token = await this.issueEmailToken(user.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
    await this.mail.sendVerifyEmail(user.email, user.name, asLocale(user.locale), token);
    await this.audit.recordPlatform({ actorUserId: user.id, action: 'auth.register', entityType: 'user', entityId: user.id, meta });
    return { status: 'verification_sent' };
  }

  async verifyEmail(token: string, meta: RequestMeta): Promise<{ status: 'verified' }> {
    const userId = await this.consumeEmailToken(token, 'VERIFY_EMAIL');
    await this.db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.recordPlatform({ actorUserId: userId, action: 'auth.email.verified', entityType: 'user', entityId: userId, meta });
    return { status: 'verified' };
  }

  async resendVerification(email: string): Promise<{ status: 'ok' }> {
    const user = await this.db.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt && user.status === 'ACTIVE') {
      const token = await this.issueEmailToken(user.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
      await this.mail.sendVerifyEmail(user.email, user.name, asLocale(user.locale), token);
    }
    return { status: 'ok' };
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<{ user: ReturnType<typeof publicUser>; tokens: TokenPair }> {
    const user = await this.db.user.findUnique({ where: { email: input.email } });

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.recordPlatform({ actorUserId: user.id, action: 'auth.login.locked', meta });
      throw new HttpException('too_many_attempts', HttpStatus.TOO_MANY_REQUESTS);
    }

    const ok = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !ok) {
      if (user) await this.registerFailure(user, meta, 'bad_password');
      throw new UnauthorizedException('invalid_credentials');
    }
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('invalid_credentials');

    if (user.mfaEnabledAt && user.mfaSecretEnc) {
      if (!input.mfaCode && !input.recoveryCode) {
        // Password was correct; the client must re-submit with a second factor.
        throw new UnauthorizedException({ statusCode: 401, error: 'mfa_required', message: 'mfa_required' });
      }
      const passed = input.mfaCode
        ? this.mfa.verify(user.id, user.mfaSecretEnc, input.mfaCode)
        : await this.useRecoveryCode(user, input.recoveryCode!);
      if (!passed) {
        await this.registerFailure(user, meta, 'bad_mfa');
        throw new UnauthorizedException('invalid_mfa_code');
      }
    }

    const data: { failedLoginCount: number; lockedUntil: null; lastLoginAt: Date; passwordHash?: string } = {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    };
    if (this.passwords.needsRehash(user.passwordHash)) data.passwordHash = await this.passwords.hash(input.password);
    const updated = await this.db.user.update({ where: { id: user.id }, data });

    const tokens = await this.tokens.createSession(user.id, meta);
    await this.audit.recordPlatform({ actorUserId: user.id, action: 'auth.login.success', meta });
    return { user: publicUser(updated), tokens };
  }

  private async useRecoveryCode(user: User, code: string): Promise<boolean> {
    const hash = sha256(code);
    if (!user.mfaRecoveryHashes.includes(hash)) return false;
    await this.db.user.update({
      where: { id: user.id },
      data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter((h) => h !== hash) },
    });
    return true;
  }

  private async registerFailure(user: User, meta: RequestMeta, reason: string): Promise<void> {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= this.env.LOGIN_MAX_FAILURES;
    await this.db.user.update({
      where: { id: user.id },
      data: lock
        ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + this.env.LOGIN_LOCK_MINUTES * 60_000) }
        : { failedLoginCount: failures },
    });
    await this.audit.recordPlatform({ actorUserId: user.id, action: lock ? 'auth.login.lockout' : 'auth.login.failed', metadata: { reason }, meta });
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPair> {
    const r = await this.tokens.rotate(refreshToken, meta);
    if (r.kind === 'reuse') {
      await this.audit.recordPlatform({ actorUserId: r.userId, action: 'auth.refresh.reuse_detected', metadata: { familyId: r.familyId }, meta });
      throw new UnauthorizedException('refresh_token_reused');
    }
    const user = await this.db.user.findUnique({ where: { id: r.userId } });
    if (!user || user.status !== 'ACTIVE') {
      await this.tokens.revokeAllForUser(r.userId);
      throw new UnauthorizedException('invalid_refresh_token');
    }
    return r.tokens;
  }

  async logout(user: AuthUser, meta: RequestMeta): Promise<void> {
    await this.tokens.revokeSessionFamilyById(user.sessionId);
    await this.audit.recordPlatform({ actorUserId: user.id, action: 'auth.logout', meta });
  }

  async logoutAll(user: AuthUser, meta: RequestMeta): Promise<{ revoked: number }> {
    const revoked = await this.tokens.revokeAllForUser(user.id);
    await this.audit.recordPlatform({ actorUserId: user.id, action: 'auth.logout_all', metadata: { revoked }, meta });
    return { revoked };
  }

  async forgotPassword(email: string, meta: RequestMeta): Promise<{ status: 'ok' }> {
    const user = await this.db.user.findUnique({ where: { email } });
    if (user && user.status === 'ACTIVE') {
      const token = await this.issueEmailToken(user.id, 'RESET_PASSWORD', RESET_TTL_MS);
      await this.mail.sendPasswordReset(user.email, asLocale(user.locale), token);
      await this.audit.recordPlatform({ actorUserId: user.id, action: 'auth.password.reset_requested', meta });
    }
    return { status: 'ok' };
  }

  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<{ status: 'ok' }> {
    const userId = await this.consumeEmailToken(token, 'RESET_PASSWORD');
    const passwordHash = await this.passwords.hash(password);
    // Clicking the emailed link proves ownership of the address.
    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: new Date() },
    });
    const revoked = await this.tokens.revokeAllForUser(userId);
    await this.audit.recordPlatform({ actorUserId: userId, action: 'auth.password.reset', metadata: { sessionsRevoked: revoked }, meta });
    return { status: 'ok' };
  }

  async mfaSetup(user: AuthUser): Promise<{ secret: string; otpauthUrl: string }> {
    if (user.mfaEnabled) throw new ConflictException('mfa_already_enabled');
    const { secret, encrypted, otpauthUrl } = this.mfa.createSecret(user.id, user.email);
    await this.db.user.update({ where: { id: user.id }, data: { mfaSecretEnc: encrypted } });
    return { secret, otpauthUrl };
  }

  async mfaEnable(user: AuthUser, code: string, meta: RequestMeta): Promise<{ recoveryCodes: string[] }> {
    const u = await this.db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (u.mfaEnabledAt) throw new ConflictException('mfa_already_enabled');
    if (!u.mfaSecretEnc) throw new BadRequestException('mfa_setup_required');
    if (!this.mfa.verify(u.id, u.mfaSecretEnc, code)) throw new BadRequestException('invalid_mfa_code');
    const { codes, hashes } = this.mfa.createRecoveryCodes();
    await this.db.user.update({ where: { id: u.id }, data: { mfaEnabledAt: new Date(), mfaRecoveryHashes: hashes } });
    await this.audit.recordPlatform({ actorUserId: u.id, action: 'auth.mfa.enabled', meta });
    return { recoveryCodes: codes };
  }

  async mfaDisable(user: AuthUser, code: string, password: string, meta: RequestMeta): Promise<{ status: 'ok' }> {
    const u = await this.db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.mfaEnabledAt || !u.mfaSecretEnc) throw new BadRequestException('mfa_not_enabled');
    const ok = (await this.passwords.verify(u.passwordHash, password)) && this.mfa.verify(u.id, u.mfaSecretEnc, code);
    if (!ok) throw new UnauthorizedException('invalid_credentials');
    await this.db.user.update({ where: { id: u.id }, data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaRecoveryHashes: [] } });
    await this.audit.recordPlatform({ actorUserId: u.id, action: 'auth.mfa.disabled', meta });
    return { status: 'ok' };
  }
}
