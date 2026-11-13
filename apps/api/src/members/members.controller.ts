import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { PERMISSIONS, inviteMemberSchema, updateMemberSchema, verifyEmailSchema } from '@mtjari/shared';
import { ZodPipe } from '../common/zod.pipe';
import { Meta, type RequestMeta } from '../common/request-meta';
import { CurrentUser, RequireVerifiedEmail, type AuthUser } from '../auth/decorators';
import { RequirePermission, StoreAccessGuard, Tenant, type TenantContext } from '../tenancy/tenancy';
import { MembersService } from './members.service';

const uuid = new ParseUUIDPipe({ version: '4' });

@Controller('v1/stores/:storeId')
@UseGuards(StoreAccessGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @RequirePermission(PERMISSIONS.MEMBERS_READ) @Get('members')
  list(@Tenant() t: TenantContext) {
    return this.members.list(t);
  }

  @RequirePermission(PERMISSIONS.MEMBERS_UPDATE) @Patch('members/:memberId')
  update(@Tenant() t: TenantContext, @Param('memberId', uuid) id: string, @Body(new ZodPipe(updateMemberSchema)) body: { roleId: string }, @Meta() meta: RequestMeta) {
    return this.members.updateRole(t, id, body.roleId, meta);
  }

  @RequirePermission(PERMISSIONS.MEMBERS_REMOVE) @Delete('members/:memberId') @HttpCode(204)
  async remove(@Tenant() t: TenantContext, @Param('memberId', uuid) id: string, @Meta() meta: RequestMeta) {
    await this.members.remove(t, id, meta);
  }

  @Post('leave') @HttpCode(204)
  async leave(@Tenant() t: TenantContext, @Meta() meta: RequestMeta) {
    await this.members.leave(t, meta);
  }

  @RequirePermission(PERMISSIONS.MEMBERS_READ) @Get('invitations')
  invitations(@Tenant() t: TenantContext) {
    return this.members.listInvitations(t);
  }

  @RequirePermission(PERMISSIONS.MEMBERS_INVITE) @Post('invitations')
  invite(@Tenant() t: TenantContext, @CurrentUser() user: AuthUser, @Body(new ZodPipe(inviteMemberSchema)) body: { email: string; roleId: string }, @Meta() meta: RequestMeta) {
    return this.members.invite(t, body.email, body.roleId, user.locale === 'en' ? 'en' : 'ar', meta);
  }

  @RequirePermission(PERMISSIONS.MEMBERS_INVITE) @Delete('invitations/:invitationId') @HttpCode(204)
  async revoke(@Tenant() t: TenantContext, @Param('invitationId', uuid) id: string, @Meta() meta: RequestMeta) {
    await this.members.revokeInvitation(t, id, meta);
  }
}

@Controller('v1/invitations')
export class InvitationsController {
  constructor(private readonly members: MembersService) {}

  @RequireVerifiedEmail() @Post('accept') @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Body(new ZodPipe(verifyEmailSchema)) body: { token: string }, @Meta() meta: RequestMeta) {
    return this.members.accept(user, body.token, meta);
  }
}
