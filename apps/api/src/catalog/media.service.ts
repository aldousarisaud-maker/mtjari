import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { TxClient } from '@mtjari/db';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import { AuditService } from '../audit/audit.service';
import { STORAGE, type StorageDriver } from '../storage/storage';
import type { TenantContext } from '../tenancy/tenancy';
import { ProductsService, mediaKeys } from './products.service';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 12;
const TARGET_WIDTHS = [400, 800, 1600];
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif']);

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly products: ProductsService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  private tx<T>(t: TenantContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: t.storeId, userId: t.userId }, fn);
  }

  /**
   * The upload is decoded and re-encoded with sharp: anything that is not a
   * real image is rejected regardless of its file name or declared type, and
   * metadata (EXIF/GPS) and any embedded payload are dropped.
   */
  private async render(buffer: Buffer): Promise<{ width: number; height: number; files: { width: number; data: Buffer }[] }> {
    if (!buffer?.length) throw new BadRequestException('file_required');
    if (buffer.length > MAX_IMAGE_BYTES) throw new PayloadTooLargeException('file_too_large');
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try {
      meta = await sharp(buffer, { limitInputPixels: 50_000_000 }).metadata();
    } catch {
      throw new BadRequestException('invalid_image');
    }
    if (!meta.format || !ALLOWED_FORMATS.has(meta.format) || !meta.width || !meta.height) throw new BadRequestException('invalid_image');
    const rotated = (meta.orientation ?? 1) >= 5;
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;
    const widths = TARGET_WIDTHS.filter((w) => w < width);
    if (widths.length < TARGET_WIDTHS.length) widths.push(Math.min(width, TARGET_WIDTHS[TARGET_WIDTHS.length - 1]!));
    try {
      const files = await Promise.all(
        [...new Set(widths)].sort((a, b) => a - b).map(async (w) => ({
          width: w,
          data: await sharp(buffer, { limitInputPixels: 50_000_000 }).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
        })),
      );
      return { width, height, files };
    } catch {
      throw new BadRequestException('invalid_image');
    }
  }

  async upload(t: TenantContext, productId: string, buffer: Buffer, alt: { altAr?: string | null; altEn?: string | null }, meta: RequestMeta) {
    const pre = await this.tx(t, (tx) =>
      tx.product.findFirst({ where: { id: productId, storeId: t.storeId, deletedAt: null }, select: { id: true, _count: { select: { media: true } } } }),
    );
    if (!pre) throw new NotFoundException('product_not_found');
    if (pre._count.media >= MAX_IMAGES_PER_PRODUCT) throw new ConflictException('too_many_images');

    const rendered = await this.render(buffer);
    const id = randomUUID();
    const keyBase = `stores/${t.storeId}/products/${productId}/${id}`;
    const widths = rendered.files.map((f) => f.width);
    await Promise.all(rendered.files.map((f) => this.storage.put(`${keyBase}-${f.width}.webp`, f.data, 'image/webp')));

    try {
      const row = await this.tx(t, async (tx) => {
        const count = await tx.productMedia.count({ where: { productId } });
        if (count >= MAX_IMAGES_PER_PRODUCT) throw new ConflictException('too_many_images');
        const created = await tx.productMedia.create({
          data: { id, storeId: t.storeId, productId, keyBase, widths, width: rendered.width, height: rendered.height, altAr: alt.altAr ?? null, altEn: alt.altEn ?? null, position: count },
        });
        await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'product.image_added', entityType: 'product', entityId: productId, metadata: { mediaId: id }, meta });
        return created;
      });
      return this.products.presentMedia(row);
    } catch (e) {
      await this.storage.remove(mediaKeys({ keyBase, widths })).catch(() => undefined); // no orphaned files
      throw e;
    }
  }

  async update(t: TenantContext, productId: string, mediaId: string, data: { altAr?: string | null; altEn?: string | null; position?: number }) {
    const row = await this.tx(t, async (tx) => {
      const current = await tx.productMedia.findFirst({ where: { id: mediaId, productId, storeId: t.storeId } });
      if (!current) throw new NotFoundException('media_not_found');
      return tx.productMedia.update({ where: { id: mediaId }, data });
    });
    return this.products.presentMedia(row);
  }

  async remove(t: TenantContext, productId: string, mediaId: string, meta: RequestMeta): Promise<void> {
    const row = await this.tx(t, async (tx) => {
      const current = await tx.productMedia.findFirst({ where: { id: mediaId, productId, storeId: t.storeId } });
      if (!current) throw new NotFoundException('media_not_found');
      await tx.productMedia.delete({ where: { id: mediaId } });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'product.image_removed', entityType: 'product', entityId: productId, metadata: { mediaId }, meta });
      return current;
    });
    await this.storage.remove(mediaKeys(row));
  }
}
