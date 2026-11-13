import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { randomToken, sha256 } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export type RotateResult =
  | { kind: 'ok'; userId: string; tokens: TokenPair }
  | { kind: 'reuse'; userId: string; familyId: string };

@Injectable()
export class TokensService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }

  private async pair(userId: string, sessionId: string, refreshToken: string, expiresAt: Date): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: sessionId });
    return {
      accessToken,
      accessTokenExpiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  async createSession(userId: string, meta: RequestMeta): Promise<TokenPair> {
    const refreshToken = randomToken(48);
    const expiresAt = this.refreshExpiry();
    const session = await this.prisma.client.session.create({
      data: {
        userId,
        familyId: randomUUID(),
        tokenHash: sha256(refreshToken),
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return this.pair(userId, session.id, refreshToken, expiresAt);
  }

  /**
   * Refresh-token rotation with reuse detection. Presenting a token that was
   * already rotated means it was stolen (or replayed): the whole family is
   * revoked and the caller must log in again.
   */
  async rotate(refreshToken: string, meta: RequestMeta): Promise<RotateResult> {
    const current = await this.prisma.client.session.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!current) throw new UnauthorizedException('invalid_refresh_token');

    if (current.replacedById || current.revokedAt) {
      await this.revokeFamily(current.familyId);
      return { kind: 'reuse', userId: current.userId, familyId: current.familyId };
    }
    if (current.expiresAt <= new Date()) throw new UnauthorizedException('refresh_token_expired');

    const nextToken = randomToken(48);
    const expiresAt = this.refreshExpiry();
    const result = await this.prisma.client.$transaction(async (tx) => {
      const next = await tx.session.create({
        data: {
          userId: current.userId,
          familyId: current.familyId,
          tokenHash: sha256(nextToken),
          expiresAt,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      // Atomic claim: only one concurrent refresh with the same token wins.
      const claimed = await tx.session.updateMany({
        where: { id: current.id, replacedById: null, revokedAt: null },
        data: { replacedById: next.id, lastUsedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ConcurrentRefresh();
      return next;
    }).catch(async (e) => {
      if (e instanceof ConcurrentRefresh) {
        await this.revokeFamily(current.familyId);
        return null;
      }
      throw e;
    });

    if (!result) return { kind: 'reuse', userId: current.userId, familyId: current.familyId };
    return { kind: 'ok', userId: current.userId, tokens: await this.pair(current.userId, result.id, nextToken, expiresAt) };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.client.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeSessionFamilyById(sessionId: string): Promise<void> {
    const s = await this.prisma.client.session.findUnique({ where: { id: sessionId }, select: { familyId: true } });
    if (s) await this.revokeFamily(s.familyId);
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const r = await this.prisma.client.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return r.count;
  }
}

class ConcurrentRefresh extends Error {}
