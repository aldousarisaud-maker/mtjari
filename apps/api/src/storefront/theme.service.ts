import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TxClient } from '@mtjari/db';
import { THEMES, THEME_IDS, isThemeId, resolveThemeSettings, type ThemeDraftInput, type ThemeId } from '@mtjari/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import type { TenantContext } from '../tenancy/tenancy';
import { PreviewTokens } from './preview';

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

@Injectable()
export class ThemeService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly previews: PreviewTokens) {}

  private tx<T>(t: TenantContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: t.storeId, userId: t.userId }, fn);
  }

  /** Everything the theme screen shows: every available theme with this store's settings, and launch readiness. */
  async overview(t: TenantContext) {
    return this.tx(t, async (tx) => {
      const [store, rows, publishedProducts, domain] = await Promise.all([
        tx.store.findUniqueOrThrow({ where: { id: t.storeId }, select: { status: true, themeId: true, launchedAt: true } }),
        tx.storeTheme.findMany({ where: { storeId: t.storeId } }),
        tx.product.count({ where: { storeId: t.storeId, status: 'ACTIVE', deletedAt: null } }),
        tx.storeDomain.findFirst({ where: { storeId: t.storeId, status: { in: ['ACTIVE', 'VERIFIED'] } }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { hostname: true } }),
      ]);
      const byId = new Map(rows.map((r) => [r.themeId, r]));
      return {
        status: store.status,
        launchedAt: store.launchedAt,
        host: domain?.hostname ?? null,
        publishedThemeId: isThemeId(store.themeId) ? store.themeId : null,
        publishedProducts,
        themes: THEME_IDS.map((id) => {
          const row = byId.get(id);
          const draft = resolveThemeSettings(id, row?.draft);
          const published = row?.published ? resolveThemeSettings(id, row.published) : null;
          return {
            id, name: THEMES[id].name, sector: THEMES[id].sector, description: THEMES[id].description, dark: THEMES[id].dark,
            defaults: THEMES[id].defaults, draft, published,
            isPublished: store.themeId === id,
            hasUnpublishedChanges: store.themeId === id && !!published && !same(draft, published),
          };
        }),
      };
    });
  }

  async saveDraft(t: TenantContext, input: ThemeDraftInput, meta: RequestMeta) {
    await this.tx(t, async (tx) => {
      // Every category a product section points at must belong to this store.
      const wanted = [...new Set(input.settings.sections.flatMap((x) => (x.type === 'products' && x.categoryId ? [x.categoryId] : [])))];
      if (wanted.length) {
        const found = await tx.category.count({ where: { storeId: t.storeId, id: { in: wanted } } });
        if (found !== wanted.length) throw new BadRequestException('category_not_found');
      }
      await tx.storeTheme.upsert({
        where: { storeId_themeId: { storeId: t.storeId, themeId: input.themeId } },
        create: { storeId: t.storeId, themeId: input.themeId, draft: json(input.settings) },
        update: { draft: json(input.settings) },
      });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'theme.draft_saved', entityType: 'theme', entityId: undefined, metadata: { themeId: input.themeId }, meta });
    });
    return this.overview(t);
  }

  /** Makes a theme (with its current draft settings) the one shoppers see. Other themes' settings are untouched. */
  async publish(t: TenantContext, themeId: ThemeId, meta: RequestMeta) {
    await this.tx(t, async (tx) => {
      const row = await tx.storeTheme.findUnique({ where: { storeId_themeId: { storeId: t.storeId, themeId } } });
      const settings = json(resolveThemeSettings(themeId, row?.draft));
      const before = await tx.store.findUniqueOrThrow({ where: { id: t.storeId }, select: { themeId: true } });
      await tx.storeTheme.upsert({
        where: { storeId_themeId: { storeId: t.storeId, themeId } },
        create: { storeId: t.storeId, themeId, draft: settings, published: settings, publishedAt: new Date() },
        update: { draft: settings, published: settings, publishedAt: new Date() },
      });
      await tx.store.update({ where: { id: t.storeId }, data: { themeId } });
      await tx.storeThemeVersion.create({ data: { storeId: t.storeId, themeId, settings, createdBy: t.userId } });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'theme.published', entityType: 'theme', entityId: undefined, metadata: { themeId, previousThemeId: before.themeId }, meta });
    });
    return this.overview(t);
  }

  /** The settings that went live each time this theme was published, newest first. */
  async versions(t: TenantContext, themeId: ThemeId) {
    const rows = await this.tx(t, (tx) => tx.storeThemeVersion.findMany({
      where: { storeId: t.storeId, themeId }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, createdAt: true, createdBy: true, settings: true },
    }));
    return rows.map((r) => {
      const s = resolveThemeSettings(themeId, r.settings);
      return { id: r.id, createdAt: r.createdAt, createdBy: r.createdBy, sections: s.sections.map((x) => x.type), colors: s.colors };
    });
  }

  /** Loads an older published version into the draft. Nothing goes live until it is published again. */
  async restoreVersion(t: TenantContext, themeId: ThemeId, versionId: string, meta: RequestMeta) {
    await this.tx(t, async (tx) => {
      const v = await tx.storeThemeVersion.findFirst({ where: { storeId: t.storeId, themeId, id: versionId } });
      if (!v) throw new NotFoundException('version_not_found');
      const settings = resolveThemeSettings(themeId, v.settings);
      // Categories may have been deleted since; a product section pointing at one shows the newest products instead.
      const ids = [...new Set(settings.sections.flatMap((x) => (x.type === 'products' && x.categoryId ? [x.categoryId] : [])))];
      const alive = new Set((ids.length ? await tx.category.findMany({ where: { storeId: t.storeId, id: { in: ids } }, select: { id: true } }) : []).map((c) => c.id));
      const restored = { ...settings, sections: settings.sections.map((x) => (x.type === 'products' && x.categoryId && !alive.has(x.categoryId) ? { ...x, categoryId: null } : x)) };
      await tx.storeTheme.upsert({
        where: { storeId_themeId: { storeId: t.storeId, themeId } },
        create: { storeId: t.storeId, themeId, draft: json(restored) },
        update: { draft: json(restored) },
      });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'theme.version_restored', entityType: 'theme', entityId: undefined, metadata: { themeId, versionId }, meta });
    });
    return this.overview(t);
  }

  previewToken(t: TenantContext, themeId: ThemeId) {
    return { themeId, ...this.previews.issue(t.storeId, themeId) };
  }

  /** Opens the storefront to the public. Refused until there is something real to show. */
  async launch(t: TenantContext, meta: RequestMeta) {
    await this.tx(t, async (tx) => {
      const store = await tx.store.findUniqueOrThrow({ where: { id: t.storeId }, select: { status: true, themeId: true } });
      if (store.status === 'ACTIVE') return;
      if (store.status !== 'DRAFT') throw new BadRequestException('store_not_launchable');
      if (!isThemeId(store.themeId)) throw new BadRequestException('theme_not_published');
      const products = await tx.product.count({ where: { storeId: t.storeId, status: 'ACTIVE', deletedAt: null } });
      if (!products) throw new BadRequestException('no_published_products');
      await tx.store.update({ where: { id: t.storeId }, data: { status: 'ACTIVE', launchedAt: new Date() } });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'store.launched', entityType: 'store', entityId: t.storeId, meta });
    });
    return this.overview(t);
  }

  /** Takes the storefront offline again (back to draft). Nothing is deleted. */
  async unlaunch(t: TenantContext, meta: RequestMeta) {
    await this.tx(t, async (tx) => {
      const store = await tx.store.findUniqueOrThrow({ where: { id: t.storeId }, select: { status: true } });
      if (store.status !== 'ACTIVE') return;
      await tx.store.update({ where: { id: t.storeId }, data: { status: 'DRAFT' } });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'store.unlaunched', entityType: 'store', entityId: t.storeId, meta });
    });
    return this.overview(t);
  }
}
