import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PERMISSIONS, createStoreSchema, updateStoreSchema, type CreateStoreInput, type UpdateStoreInput } from "@mtjari/shared";
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { Meta, type RequestMeta } from '../common/request-meta';
import { CurrentUser, RequireVerifiedEmail, type AuthUser } from '../auth/decorators';
import { RequirePermission, StoreAccessGuard, Tenant, type TenantContext } from '../tenancy/tenancy';
import { StoresService } from './stores.service';

const deleteSchema = z.object({ confirmSlug: z.string().max(60) });

@Controller('v1/stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get('slug-availability')
  slug(@Query('slug') slug: string) {
    return this.stores.slugAvailability(typeof slug === 'string' ? slug : '');
  }

  @RequireVerifiedEmail() @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createStoreSchema)) body: CreateStoreInput, @Meta() meta: RequestMeta) {
    return this.stores.create(user, body, meta);
  }

  @UseGuards(StoreAccessGuard) @RequirePermission(PERMISSIONS.STORE_READ) @Get(':storeId')
  get(@Tenant() t: TenantContext) {
    return this.stores.get(t);
  }

  @UseGuards(StoreAccessGuard) @RequirePermission(PERMISSIONS.STORE_UPDATE) @Patch(':storeId')
  update(@Tenant() t: TenantContext, @Body(new ZodPipe(updateStoreSchema)) body: UpdateStoreInput, @Meta() meta: RequestMeta) {
    return this.stores.update(t, body, meta);
  }

  @UseGuards(StoreAccessGuard) @RequirePermission(PERMISSIONS.STORE_DELETE) @Delete(':storeId') @HttpCode(204)
  async remove(@Tenant() t: TenantContext, @Body(new ZodPipe(deleteSchema)) body: { confirmSlug: string }, @Meta() meta: RequestMeta) {
    await this.stores.remove(t, body.confirmSlug, meta);
  }
}
