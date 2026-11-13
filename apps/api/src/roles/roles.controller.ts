import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ALL_PERMISSIONS, PERMISSIONS, roleSchema } from '@mtjari/shared';
import { ZodPipe } from '../common/zod.pipe';
import { Meta, type RequestMeta } from '../common/request-meta';
import { RequirePermission, StoreAccessGuard, Tenant, type TenantContext } from '../tenancy/tenancy';
import { RolesService } from './roles.service';

type RoleBody = { name: string; permissions: string[] };
const uuid = new ParseUUIDPipe({ version: '4' });

@Controller('v1/stores/:storeId/roles')
@UseGuards(StoreAccessGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermission(PERMISSIONS.ROLES_READ) @Get()
  list(@Tenant() t: TenantContext) {
    return this.roles.list(t);
  }

  /** Catalogue of permissions the UI can offer when building a custom role. */
  @RequirePermission(PERMISSIONS.ROLES_READ) @Get('permissions')
  permissions() {
    return { permissions: ALL_PERMISSIONS };
  }

  @RequirePermission(PERMISSIONS.ROLES_MANAGE) @Post()
  create(@Tenant() t: TenantContext, @Body(new ZodPipe(roleSchema)) body: RoleBody, @Meta() meta: RequestMeta) {
    return this.roles.create(t, body.name, body.permissions, meta);
  }

  @RequirePermission(PERMISSIONS.ROLES_MANAGE) @Put(':roleId')
  update(@Tenant() t: TenantContext, @Param('roleId', uuid) id: string, @Body(new ZodPipe(roleSchema)) body: RoleBody, @Meta() meta: RequestMeta) {
    return this.roles.update(t, id, body.name, body.permissions, meta);
  }

  @RequirePermission(PERMISSIONS.ROLES_MANAGE) @Delete(':roleId') @HttpCode(204)
  async remove(@Tenant() t: TenantContext, @Param('roleId', uuid) id: string, @Meta() meta: RequestMeta) {
    await this.roles.remove(t, id, meta);
  }
}
