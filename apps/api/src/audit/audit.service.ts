import { Injectable } from '@nestjs/common';
import type { ActorType, Prisma, TxClient } from '@mtjari/db';
import type { RequestMeta } from '../common/request-meta';
import { PrismaService } from '../common/prisma.service';

export interface AuditEntry {
  storeId?: string | null;
  actorUserId?: string | null;
  actorType?: ActorType;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  meta?: RequestMeta;
}

const SENSITIVE_KEY = /pass|secret|token|key|code|authorization|cookie/i;

/** Strip anything that looks like a credential before it reaches the log table. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1)]),
    );
  }
  return value;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  private data(e: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
    return {
      storeId: e.storeId ?? null,
      actorUserId: e.actorUserId ?? null,
      actorType: e.actorType ?? 'USER',
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      metadata: (redact(e.metadata ?? {}) as Prisma.InputJsonValue),
      ip: e.meta?.ip ?? null,
      userAgent: e.meta?.userAgent ?? null,
      requestId: e.meta?.requestId ?? null,
    };
  }

  /** Write inside an existing tenant transaction (commits/rolls back with the change). */
  // createMany = INSERT without RETURNING: audit rows are write-only for the
  // app, and platform rows (store_id NULL) are deliberately not SELECT-able.
  async record(tx: TxClient, e: AuditEntry): Promise<void> {
    await tx.auditLog.createMany({ data: [this.data(e)] });
  }

  /** Platform-level event (no store), e.g. auth events. */
  async recordPlatform(e: Omit<AuditEntry, 'storeId'>): Promise<void> {
    await this.prisma.client.auditLog.createMany({ data: [this.data({ ...e, storeId: null })] });
  }
}
