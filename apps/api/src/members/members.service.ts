import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { findInvitationStoreId, type TxClient } from '@mtjari/db';
import { OWNER_ROLE_KEY } from '@mtjari/shared';
import { randomToken, sha256 } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import type { AuthUser } from '../auth/decorators';
import type { TenantContext } from '../tenancy/tenancy';
import { canGrantRole } from './rbac-rules';

const INVITE_TTL_MS = 7 * 86_400_000;

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly mail: MailService) {}

  private tx<T>(t: TenantContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: t.storeId, userId: t.userId }, fn);
  }

  private async ownerCount(tx: TxClient, storeId: string) {
    return tx.membership.count({ where: { storeId, status: 'ACTIVE', role: { key: OWNER_ROLE_KEY } } });
  }

  list(t: TenantContext) {
    return this.tx(t, async (tx) => {
      const rows = await tx.membership.findMany({
        where: { storeId: t.storeId },
        include: { user: { select: { id: true, name: true, email: true, mfaEnabledAt: true } }, role: { select: { id: true, key: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((m) => ({
        id: m.id, status: m.status, createdAt: m.createdAt, role: m.role,
        user: { id: m.user.id, name: m.user.name, email: m.user.email, mfaEnabled: !!m.user.mfaEnabledAt },
      }));
    });
  }

  updateRole(t: TenantContext, memberId: string, roleId: string, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const member = await tx.membership.findFirst({ where: { id: memberId, storeId: t.storeId }, include: { role: true } });
      if (!member) throw new NotFoundException('member_not_found');
      if (member.userId === t.userId) throw new ForbiddenException('cannot_change_own_role');
      const role = await tx.role.findFirst({ where: { id: roleId, storeId: t.storeId } });
      if (!role) throw new NotFoundException('role_not_found');
      if (!canGrantRole(t, role) || !canGrantRole(t, member.role)) throw new ForbiddenException('role_escalation_denied');
      if (member.role.key === OWNER_ROLE_KEY && role.key !== OWNER_ROLE_KEY && (await this.ownerCount(tx, t.storeId)) <= 1) {
        throw new ConflictException('last_owner');
      }
      const updated = await tx.membership.update({ where: { id: member.id }, data: { roleId: role.id } });
      await this.audit.record(tx, {
        storeId: t.storeId, actorUserId: t.userId, action: 'member.role_changed', entityType: 'membership', entityId: member.id,
        metadata: { userId: member.userId, from: member.role.name, to: role.name }, meta,
      });
      return updated;
    });
  }

  remove(t: TenantContext, memberId: string, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const member = await tx.membership.findFirst({ where: { id: memberId, storeId: t.storeId }, include: { role: true } });
      if (!member) throw new NotFoundException('member_not_found');
      if (member.userId === t.userId) throw new BadRequestException('use_leave_endpoint');
      if (!canGrantRole(t, member.role)) throw new ForbiddenException('role_escalation_denied');
      if (member.role.key === OWNER_ROLE_KEY && (await this.ownerCount(tx, t.storeId)) <= 1) throw new ConflictException('last_owner');
      await tx.membership.delete({ where: { id: member.id } });
      await this.audit.record(tx, {
        storeId: t.storeId, actorUserId: t.userId, action: 'member.removed', entityType: 'membership', entityId: member.id,
        metadata: { userId: member.userId, role: member.role.name }, meta,
      });
    });
  }

  leave(t: TenantContext, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      if (t.isOwner && (await this.ownerCount(tx, t.storeId)) <= 1) throw new ConflictException('last_owner');
      await tx.membership.delete({ where: { id: t.membershipId } });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'member.left', entityType: 'membership', entityId: t.membershipId, meta });
    });
  }

  listInvitations(t: TenantContext) {
    return this.tx(t, (tx) =>
      tx.invitation.findMany({
        where: { storeId: t.storeId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, email: true, expiresAt: true, createdAt: true, role: { select: { id: true, name: true, key: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async invite(t: TenantContext, email: string, roleId: string, locale: 'ar' | 'en', meta: RequestMeta) {
    const token = randomToken(32);
    const { invitation, storeName } = await this.tx(t, async (tx) => {
      const role = await tx.role.findFirst({ where: { id: roleId, storeId: t.storeId } });
      if (!role) throw new NotFoundException('role_not_found');
      if (!canGrantRole(t, role)) throw new ForbiddenException('role_escalation_denied');
      const alreadyMember = await tx.membership.findFirst({ where: { storeId: t.storeId, user: { email } } });
      if (alreadyMember) throw new ConflictException('already_member');
      // Re-inviting replaces any pending invitation for the same address.
      await tx.invitation.updateMany({ where: { storeId: t.storeId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const invitation = await tx.invitation.create({
        data: { storeId: t.storeId, email, roleId: role.id, tokenHash: sha256(token), invitedById: t.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      });
      const store = await tx.store.findUniqueOrThrow({ where: { id: t.storeId }, select: { name: true } });
      await this.audit.record(tx, {
        storeId: t.storeId, actorUserId: t.userId, action: 'member.invited', entityType: 'invitation', entityId: invitation.id,
        metadata: { email, role: role.name }, meta,
      });
      return { invitation, storeName: store.name };
    });
    await this.mail.sendInvitation(email, locale, storeName, token);
    return { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt };
  }

  revokeInvitation(t: TenantContext, invitationId: string, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const r = await tx.invitation.updateMany({ where: { id: invitationId, storeId: t.storeId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (r.count !== 1) throw new NotFoundException('invitation_not_found');
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'member.invitation_revoked', entityType: 'invitation', entityId: invitationId, meta });
    });
  }

  async accept(user: AuthUser, token: string, meta: RequestMeta) {
    const tokenHash = sha256(token);
    const storeId = await findInvitationStoreId(this.prisma.client, tokenHash);
    if (!storeId) throw new BadRequestException('invalid_or_expired_invitation');
    return this.prisma.tx({ storeId, userId: user.id }, async (tx) => {
      const inv = await tx.invitation.findUnique({ where: { tokenHash } });
      if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) throw new BadRequestException('invalid_or_expired_invitation');
      // The invitation is bound to the address it was sent to.
      if (inv.email !== user.email) throw new ForbiddenException('invitation_email_mismatch');
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException('invalid_or_expired_invitation');
      const existing = await tx.membership.findUnique({ where: { storeId_userId: { storeId, userId: user.id } } });
      if (existing) throw new ConflictException('already_member');
      const membership = await tx.membership.create({ data: { storeId, userId: user.id, roleId: inv.roleId } });
      await this.audit.record(tx, {
        storeId, actorUserId: user.id, action: 'member.joined', entityType: 'membership', entityId: membership.id,
        metadata: { invitationId: inv.id }, meta,
      });
      return { storeId, membershipId: membership.id };
    });
  }
}
