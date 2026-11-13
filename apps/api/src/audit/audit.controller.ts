import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PERMISSIONS, auditQuerySchema } from '@mtjari/shared';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../common/prisma.service';
import { RequirePermission, StoreAccessGuard, Tenant, type TenantContext } from '../tenancy/tenancy';

@Controller('v1/stores/:storeId/audit-logs')
@UseGuards(StoreAccessGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermission(PERMISSIONS.AUDIT_READ) @Get()
  async list(@Tenant() t: TenantContext, @Query(new ZodPipe(auditQuerySchema)) q: { cursor?: string; limit: number; action?: string }) {
    const rows = await this.prisma.tx({ storeId: t.storeId, userId: t.userId }, (tx) =>
      tx.auditLog.findMany({
        where: { storeId: t.storeId, ...(q.action ? { action: q.action } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
    );
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }
}
