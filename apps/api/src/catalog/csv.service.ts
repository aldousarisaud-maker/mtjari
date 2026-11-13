import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import type { TxClient } from '@mtjari/db';
import {
  CSV_COLUMNS, IMPORT_MAX_ROWS, fromMinor, parseCsvRecords, productCreateSchema, slugify, toCsv, toMinor,
  type ProductCreateInput,
} from '@mtjari/shared';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../tenancy/tenancy';
import { InventoryService } from './inventory.service';
import { ProductsService } from './products.service';
import { isUniqueViolation } from './helpers';

export interface ImportReport {
  rows: number;
  productsCreated: number;
  variantsUpdated: number;
  errors: { row: number; message: string }[];
}

type Row = Record<string, string> & { __row: number };
class RowError extends Error {
  constructor(readonly row: number, message: string) {
    super(message);
  }
}

@Injectable()
export class CsvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly products: ProductsService,
    private readonly inventory: InventoryService,
  ) {}

  private tx<T>(t: TenantContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: t.storeId, userId: t.userId }, fn);
  }

  /** One row per variant; the same columns the import accepts. */
  async export(t: TenantContext): Promise<string> {
    const { currency, products } = await this.tx(t, async (tx) => ({
      currency: (await tx.store.findUniqueOrThrow({ where: { id: t.storeId }, select: { currency: true } })).currency,
      products: await tx.product.findMany({
        where: { storeId: t.storeId, deletedAt: null }, orderBy: { createdAt: 'asc' },
        include: {
          brand: { select: { name: true } },
          options: { orderBy: { position: 'asc' } },
          variants: { orderBy: { position: 'asc' } },
          categories: { select: { category: { select: { nameAr: true, nameEn: true } } } },
        },
      }),
    }));
    const money = (v: number | null) => (v == null ? '' : fromMinor(v, currency));
    const rows = products.flatMap((p) =>
      p.variants.map((v) => {
        const ov = v.optionValues as Record<string, string>;
        const opts = [0, 1, 2].flatMap((i) => { const o = p.options[i]; return o ? [o.name, ov[o.name] ?? ''] : ['', '']; });
        return [
          p.slug, p.nameAr ?? '', p.nameEn ?? '', p.type, p.status, p.brand?.name ?? '',
          p.categories.map((c) => c.category.nameEn ?? c.category.nameAr).join('|'),
          v.sku ?? '', v.barcode ?? '', money(v.price), money(v.compareAtPrice), money(v.cost),
          v.trackInventory ? v.stockQuantity : '', v.lowStockThreshold ?? '', ...opts,
        ];
      }),
    );
    return toCsv([...CSV_COLUMNS], rows);
  }

  /**
   * Rows that share a slug form one product. A slug that does not exist yet
   * creates the product with its variants; an existing slug updates prices and
   * stock of the variants matched by SKU. Each product is its own transaction,
   * so one bad product does not block the rest; every problem is reported with
   * its row number.
   */
  async import(t: TenantContext, csv: string, meta: RequestMeta): Promise<ImportReport> {
    let parsed: ReturnType<typeof parseCsvRecords>;
    try {
      parsed = parseCsvRecords(csv);
    } catch {
      throw new BadRequestException('csv_malformed');
    }
    if (!parsed.records.length) throw new BadRequestException('csv_empty');
    if (parsed.records.length > IMPORT_MAX_ROWS) throw new BadRequestException('csv_too_many_rows');
    if (!parsed.headers.includes('price') || !(parsed.headers.includes('name_ar') || parsed.headers.includes('name_en'))) {
      throw new BadRequestException('csv_missing_columns');
    }
    const currency = (await this.tx(t, (tx) => tx.store.findUniqueOrThrow({ where: { id: t.storeId }, select: { currency: true } }))).currency;
    const report: ImportReport = { rows: parsed.records.length, productsCreated: 0, variantsUpdated: 0, errors: [] };

    const groups = new Map<string, Row[]>();
    parsed.records.forEach((r, i) => {
      const row = { ...r, __row: i + 2 } as Row; // +1 header, +1 one-based
      const slug = (row.slug || slugify(row.name_en || row.name_ar || '')).toLowerCase();
      if (!slug) return report.errors.push({ row: row.__row, message: 'name_required' });
      groups.set(slug, [...(groups.get(slug) ?? []), row]);
    });

    for (const [slug, rows] of groups) {
      try {
        await this.tx(t, async (tx) => {
          const existing = await tx.product.findFirst({ where: { storeId: t.storeId, slug, deletedAt: null }, include: { variants: true } });
          if (existing) {
            for (const row of rows) {
              const variant = row.sku ? existing.variants.find((v) => v.sku === row.sku) : existing.variants.length === 1 ? existing.variants[0] : undefined;
              if (!variant) throw new RowError(row.__row, row.sku ? 'sku_not_found_in_product' : 'sku_required');
              const m = this.money(row, currency);
              await tx.productVariant.update({
                where: { id: variant.id },
                data: { price: m.price, compareAtPrice: m.compareAtPrice, cost: m.cost, ...(row.barcode ? { barcode: row.barcode } : {}) },
              });
              if (row.stock !== undefined && row.stock !== '' && variant.trackInventory) {
                await this.inventory.applyInTx(tx, t, variant.id, { setTo: this.int(row, 'stock') }, 'IMPORT', null);
              }
              report.variantsUpdated++;
            }
          } else {
            const input = await this.buildProduct(tx, t, slug, rows, currency);
            await this.products.createInTx(tx, t, input, meta);
            report.productsCreated++;
          }
        });
      } catch (e) {
        const first = rows[0]!.__row;
        if (e instanceof RowError) report.errors.push({ row: e.row, message: e.message });
        else if (isUniqueViolation(e)) report.errors.push({ row: first, message: 'sku_taken' });
        else if (e instanceof HttpException) report.errors.push({ row: first, message: this.httpMessage(e) });
        else throw e;
      }
    }

    await this.tx(t, (tx) =>
      this.audit.record(tx, {
        storeId: t.storeId, actorUserId: t.userId, action: 'product.import', entityType: 'store', entityId: t.storeId,
        metadata: { rows: report.rows, productsCreated: report.productsCreated, variantsUpdated: report.variantsUpdated, errors: report.errors.length }, meta,
      }),
    );
    return report;
  }

  private httpMessage(e: HttpException): string {
    const res = e.getResponse();
    return typeof res === 'string' ? res : ((res as { message?: string }).message ?? 'invalid_row');
  }

  private int(row: Row, col: string): number {
    const v = row[col] ?? '';
    if (!/^\d{1,8}$/.test(v)) throw new RowError(row.__row, `invalid_${col}`);
    return Number(v);
  }

  private money(row: Row, currency: string) {
    const parse = (col: string, required: boolean): number | null => {
      const raw = row[col] ?? '';
      if (raw === '') {
        if (required) throw new RowError(row.__row, `${col}_required`);
        return null;
      }
      const minor = toMinor(raw, currency);
      if (minor === null) throw new RowError(row.__row, `invalid_${col}`);
      return minor;
    };
    const price = parse('price', true)!;
    const compareAtPrice = parse('compare_at_price', false);
    if (compareAtPrice !== null && compareAtPrice <= price) throw new RowError(row.__row, 'compare_at_must_exceed_price');
    return { price, compareAtPrice, cost: parse('cost', false) };
  }

  private async buildProduct(tx: TxClient, t: TenantContext, slug: string, rows: Row[], currency: string): Promise<ProductCreateInput> {
    const head = rows[0]!;
    const optionNames = [1, 2, 3].map((i) => head[`option${i}_name`] ?? '').filter(Boolean);
    const type = (head.type || (optionNames.length ? 'VARIANT' : 'SIMPLE')).toUpperCase();
    const options = optionNames.map((name, idx) => {
      const col = `option${idx + 1}_value`;
      const values = [...new Set(rows.map((r) => r[col] ?? '').filter(Boolean))];
      return { name, values };
    });

    let brandId: string | null = null;
    if (head.brand) {
      const bslug = slugify(head.brand);
      const brand = (await tx.brand.findFirst({ where: { storeId: t.storeId, slug: bslug } })) ??
        (await tx.brand.create({ data: { storeId: t.storeId, name: head.brand, slug: bslug } }));
      brandId = brand.id;
    }
    const categoryIds: string[] = [];
    for (const name of (head.categories ?? '').split('|').map((s) => s.trim()).filter(Boolean)) {
      const cslug = slugify(name);
      if (!cslug) continue;
      const cat = (await tx.category.findFirst({ where: { storeId: t.storeId, slug: cslug } })) ??
        (await tx.category.create({ data: { storeId: t.storeId, slug: cslug, ...(/[؀-ۿ]/.test(name) ? { nameAr: name } : { nameEn: name }) } }));
      categoryIds.push(cat.id);
    }

    const candidate = {
      slug, type, status: (head.status || 'DRAFT').toUpperCase(),
      nameAr: head.name_ar || null, nameEn: head.name_en || null, brandId, categoryIds, options,
      variants: rows.map((r) => ({
        sku: r.sku || null, barcode: r.barcode || null, ...this.money(r, currency),
        optionValues: Object.fromEntries(optionNames.map((name, idx) => [name, r[`option${idx + 1}_value`] ?? ''])),
        initialStock: r.stock ? this.int(r, 'stock') : 0,
        trackInventory: type !== 'DIGITAL',
        lowStockThreshold: r.low_stock_threshold ? this.int(r, 'low_stock_threshold') : null,
      })),
    };
    const result = productCreateSchema.safeParse(candidate);
    if (!result.success) {
      const issue = result.error.issues[0]!;
      const idx = issue.path[0] === 'variants' && typeof issue.path[1] === 'number' ? issue.path[1] : 0;
      throw new RowError(rows[idx]?.__row ?? head.__row, `${issue.path.filter((p) => typeof p === 'string').join('.') || 'row'}: ${issue.message}`);
    }
    return result.data;
  }
}
