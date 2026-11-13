import {
  BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  PERMISSIONS, brandSchema, categoryCreateSchema, categoryUpdateSchema, inventoryAdjustSchema, inventoryListQuerySchema,
  mediaUpdateSchema, movementsQuerySchema, productCreateSchema, productListQuerySchema, productUpdateSchema, relationsSchema,
  variantsReplaceSchema,
  type BrandInput, type CategoryCreateInput, type CategoryUpdateInput, type InventoryAdjustInput, type ProductCreateInput,
  type ProductListQuery, type ProductUpdateInput, type VariantsReplaceInput,
} from '@mtjari/shared';
import { ZodPipe } from '../common/zod.pipe';
import { Meta, type RequestMeta } from '../common/request-meta';
import { RequirePermission, StoreAccessGuard, Tenant, type TenantContext } from '../tenancy/tenancy';
import { CsvService } from './csv.service';
import { InventoryService } from './inventory.service';
import { MAX_IMAGE_BYTES, MediaService } from './media.service';
import { ProductsService } from './products.service';
import { TaxonomyService } from './taxonomy.service';

const uuid = new ParseUUIDPipe({ version: '4' });
const P = PERMISSIONS;
type Upload = { buffer: Buffer; size: number } | undefined;

@Controller('v1/stores/:storeId')
@UseGuards(StoreAccessGuard)
export class CatalogController {
  constructor(
    private readonly taxonomy: TaxonomyService,
    private readonly products: ProductsService,
    private readonly inventory: InventoryService,
    private readonly media: MediaService,
    private readonly csv: CsvService,
  ) {}

  // ---- categories & brands ----------------------------------------------
  @RequirePermission(P.PRODUCTS_READ) @Get('categories')
  categories(@Tenant() t: TenantContext) { return this.taxonomy.listCategories(t); }

  @RequirePermission(P.PRODUCTS_WRITE) @Post('categories')
  createCategory(@Tenant() t: TenantContext, @Body(new ZodPipe(categoryCreateSchema)) body: CategoryCreateInput, @Meta() meta: RequestMeta) {
    return this.taxonomy.createCategory(t, body, meta);
  }

  @RequirePermission(P.PRODUCTS_WRITE) @Patch('categories/:id')
  updateCategory(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Body(new ZodPipe(categoryUpdateSchema)) body: CategoryUpdateInput, @Meta() meta: RequestMeta) {
    return this.taxonomy.updateCategory(t, id, body, meta);
  }

  @RequirePermission(P.PRODUCTS_WRITE) @Delete('categories/:id') @HttpCode(204)
  async deleteCategory(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) { await this.taxonomy.deleteCategory(t, id, meta); }

  @RequirePermission(P.PRODUCTS_READ) @Get('brands')
  brands(@Tenant() t: TenantContext) { return this.taxonomy.listBrands(t); }

  @RequirePermission(P.PRODUCTS_WRITE) @Post('brands')
  createBrand(@Tenant() t: TenantContext, @Body(new ZodPipe(brandSchema)) body: BrandInput, @Meta() meta: RequestMeta) { return this.taxonomy.createBrand(t, body, meta); }

  @RequirePermission(P.PRODUCTS_WRITE) @Patch('brands/:id')
  updateBrand(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Body(new ZodPipe(brandSchema)) body: BrandInput, @Meta() meta: RequestMeta) {
    return this.taxonomy.updateBrand(t, id, body, meta);
  }

  @RequirePermission(P.PRODUCTS_WRITE) @Delete('brands/:id') @HttpCode(204)
  async deleteBrand(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) { await this.taxonomy.deleteBrand(t, id, meta); }

  // ---- products (static routes before :id) -------------------------------
  @RequirePermission(P.PRODUCTS_READ) @Get('catalog/summary')
  summary(@Tenant() t: TenantContext) { return this.products.summary(t); }

  @RequirePermission(P.PRODUCTS_READ) @Get('products/export')
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="products.csv"')
  export(@Tenant() t: TenantContext) { return this.csv.export(t); }

  @RequirePermission(P.PRODUCTS_WRITE, P.INVENTORY_WRITE) @Post('products/import') @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  import(@Tenant() t: TenantContext, @UploadedFile() file: Upload, @Meta() meta: RequestMeta) {
    if (!file?.buffer?.length) throw new BadRequestException('file_required');
    return this.csv.import(t, file.buffer.toString('utf8'), meta);
  }

  @RequirePermission(P.PRODUCTS_READ) @Get('products')
  list(@Tenant() t: TenantContext, @Query(new ZodPipe(productListQuerySchema)) q: ProductListQuery) { return this.products.list(t, q); }

  @RequirePermission(P.PRODUCTS_WRITE) @Post('products')
  create(@Tenant() t: TenantContext, @Body(new ZodPipe(productCreateSchema)) body: ProductCreateInput, @Meta() meta: RequestMeta) { return this.products.create(t, body, meta); }

  @RequirePermission(P.PRODUCTS_READ) @Get('products/:id')
  get(@Tenant() t: TenantContext, @Param('id', uuid) id: string) { return this.products.get(t, id); }

  @RequirePermission(P.PRODUCTS_WRITE) @Patch('products/:id')
  update(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Body(new ZodPipe(productUpdateSchema)) body: ProductUpdateInput, @Meta() meta: RequestMeta) {
    return this.products.update(t, id, body, meta);
  }

  @RequirePermission(P.PRODUCTS_WRITE) @Delete('products/:id') @HttpCode(204)
  async remove(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) { await this.products.remove(t, id, meta); }

  @RequirePermission(P.PRODUCTS_WRITE) @Put('products/:id/variants')
  variants(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Body(new ZodPipe(variantsReplaceSchema)) body: VariantsReplaceInput, @Meta() meta: RequestMeta) {
    return this.products.replaceVariants(t, id, body, meta);
  }

  @RequirePermission(P.PRODUCTS_WRITE) @Put('products/:id/relations')
  relations(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Body(new ZodPipe(relationsSchema)) body: { type: 'RELATED' | 'UPSELL' | 'CROSS_SELL'; productIds: string[] }, @Meta() meta: RequestMeta) {
    return this.products.setRelations(t, id, body.type, body.productIds, meta);
  }

  // ---- product images ----------------------------------------------------
  @RequirePermission(P.PRODUCTS_WRITE) @Post('products/:id/media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  upload(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @UploadedFile() file: Upload, @Body() body: Record<string, unknown>, @Meta() meta: RequestMeta) {
    if (!file?.buffer?.length) throw new BadRequestException('file_required');
    const alt = new ZodPipe(mediaUpdateSchema).transform({ altAr: body?.altAr, altEn: body?.altEn });
    return this.media.upload(t, id, file.buffer, alt, meta);
  }

  @RequirePermission(P.PRODUCTS_WRITE) @Patch('products/:id/media/:mediaId')
  updateMedia(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Param('mediaId', uuid) mediaId: string, @Body(new ZodPipe(mediaUpdateSchema)) body: { altAr?: string | null; altEn?: string | null; position?: number }) {
    return this.media.update(t, id, mediaId, body);
  }

  @RequirePermission(P.PRODUCTS_WRITE) @Delete('products/:id/media/:mediaId') @HttpCode(204)
  async removeMedia(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Param('mediaId', uuid) mediaId: string, @Meta() meta: RequestMeta) {
    await this.media.remove(t, id, mediaId, meta);
  }

  // ---- inventory ---------------------------------------------------------
  @RequirePermission(P.INVENTORY_READ) @Get('inventory')
  stock(@Tenant() t: TenantContext, @Query(new ZodPipe(inventoryListQuerySchema)) q: { q?: string; lowStock: boolean; page: number; limit: number }) {
    return this.inventory.list(t, q);
  }

  @RequirePermission(P.INVENTORY_WRITE) @Post('inventory/adjust') @HttpCode(200)
  adjust(@Tenant() t: TenantContext, @Body(new ZodPipe(inventoryAdjustSchema)) body: InventoryAdjustInput, @Meta() meta: RequestMeta) {
    return this.inventory.adjust(t, body, meta);
  }

  @RequirePermission(P.INVENTORY_READ) @Get('inventory/movements')
  movements(@Tenant() t: TenantContext, @Query(new ZodPipe(movementsQuerySchema)) q: { variantId?: string; page: number; limit: number }) {
    return this.inventory.movements(t, q);
  }
}
