import { z } from 'zod';
import { MAX_MONEY_MINOR } from './money';

/** URL slug that keeps Arabic letters: "عطر الورد 50ml" → "عطر-الورد-50ml". */
export function slugify(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // Arabic diacritics and tatweel
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/g, '');
}

const SLUG_RE = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
export const contentSlugSchema = z.string().trim().toLowerCase().min(1).max(96).regex(SLUG_RE, { message: 'invalid_slug' });

const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const money = z.number().int().min(0).max(MAX_MONEY_MINOR);
const uuid = z.uuid();

const names = { nameAr: optText(200), nameEn: optText(200) };
const hasName = (v: { nameAr?: string | null; nameEn?: string | null }) => !!(v.nameAr || v.nameEn);

export const categoryCreateSchema = z
  .strictObject({
    ...names,
    slug: contentSlugSchema.optional(),
    parentId: uuid.nullish(),
    descriptionAr: optText(5000),
    descriptionEn: optText(5000),
    sortOrder: z.number().int().min(0).max(100000).default(0),
    isActive: z.boolean().default(true),
    seoTitle: optText(70),
    seoDescription: optText(170),
  })
  .refine(hasName, { message: 'name_required', path: ['nameAr'] });
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z.strictObject({
  nameAr: optText(200).optional(),
  nameEn: optText(200).optional(),
  slug: contentSlugSchema.optional(),
  parentId: uuid.nullable().optional(),
  descriptionAr: optText(5000).optional(),
  descriptionEn: optText(5000).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
  seoTitle: optText(70).optional(),
  seoDescription: optText(170).optional(),
});
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

export const brandSchema = z.strictObject({ name: z.string().trim().min(1).max(120), slug: contentSlugSchema.optional() });
export type BrandInput = z.infer<typeof brandSchema>;

export const PRODUCT_TYPES = ['SIMPLE', 'VARIANT', 'DIGITAL'] as const;
export const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 100;

export const optionSchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  values: z.array(z.string().trim().min(1).max(60)).min(1).max(50).refine((v) => new Set(v).size === v.length, { message: 'duplicate_option_values' }),
});

export const variantInputSchema = z
  .strictObject({
    id: uuid.optional(),
    sku: optText(64),
    barcode: optText(64),
    optionValues: z.record(z.string(), z.string()).default({}),
    price: money,
    compareAtPrice: money.nullish(),
    cost: money.nullish(),
    trackInventory: z.boolean().default(true),
    lowStockThreshold: z.number().int().min(0).max(1_000_000).nullish(),
    /** Only used when the variant is first created. Later changes go through inventory adjustments. */
    initialStock: z.number().int().min(0).max(10_000_000).default(0),
  })
  .refine((v) => v.compareAtPrice == null || v.compareAtPrice > v.price, { message: 'compare_at_must_exceed_price', path: ['compareAtPrice'] });
export type VariantInput = z.infer<typeof variantInputSchema>;

const productBase = {
  ...names,
  slug: contentSlugSchema.optional(),
  descriptionAr: optText(20000),
  descriptionEn: optText(20000),
  brandId: uuid.nullish(),
  categoryIds: z.array(uuid).max(50).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  seoTitle: optText(70),
  seoDescription: optText(170),
  status: z.enum(PRODUCT_STATUSES).default('DRAFT'),
};

export const productCreateSchema = z
  .strictObject({
    ...productBase,
    type: z.enum(PRODUCT_TYPES).default('SIMPLE'),
    options: z.array(optionSchema).max(MAX_OPTIONS).default([]),
    variants: z.array(variantInputSchema).min(1).max(MAX_VARIANTS),
  })
  .refine(hasName, { message: 'name_required', path: ['nameAr'] });
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

export const productUpdateSchema = z.strictObject({
  nameAr: optText(200).optional(),
  nameEn: optText(200).optional(),
  slug: contentSlugSchema.optional(),
  descriptionAr: optText(20000).optional(),
  descriptionEn: optText(20000).optional(),
  brandId: uuid.nullable().optional(),
  categoryIds: z.array(uuid).max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  seoTitle: optText(70).optional(),
  seoDescription: optText(170).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
});
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export const variantsReplaceSchema = z.strictObject({
  options: z.array(optionSchema).max(MAX_OPTIONS).default([]),
  variants: z.array(variantInputSchema).min(1).max(MAX_VARIANTS),
});
export type VariantsReplaceInput = z.infer<typeof variantsReplaceSchema>;

/**
 * Checks that variants match the product type and its options exactly:
 * SIMPLE/DIGITAL → one variant, no options; VARIANT → every variant picks one
 * listed value for every option, and no two variants pick the same combination.
 */
export function validateVariantMatrix(
  type: (typeof PRODUCT_TYPES)[number],
  options: { name: string; values: string[] }[],
  variants: { optionValues: Record<string, string>; sku?: string | null }[],
): string | null {
  if (type !== 'VARIANT') {
    if (options.length) return 'options_not_allowed';
    if (variants.length !== 1) return 'single_variant_required';
    if (Object.keys(variants[0]!.optionValues).length) return 'options_not_allowed';
  } else {
    if (!options.length) return 'options_required';
    if (new Set(options.map((o) => o.name.toLowerCase())).size !== options.length) return 'duplicate_option_names';
    const seen = new Set<string>();
    for (const v of variants) {
      const keys = Object.keys(v.optionValues);
      if (keys.length !== options.length) return 'variant_options_mismatch';
      for (const o of options) {
        const val = v.optionValues[o.name];
        if (val === undefined || !o.values.includes(val)) return 'variant_options_mismatch';
      }
      const combo = options.map((o) => v.optionValues[o.name]).join('\u0000');
      if (seen.has(combo)) return 'duplicate_variant';
      seen.add(combo);
    }
  }
  const skus = variants.map((v) => v.sku).filter((s): s is string => !!s);
  if (new Set(skus).size !== skus.length) return 'duplicate_sku';
  return null;
}

/** All combinations of option values, in option order. */
export function generateVariantMatrix(options: { name: string; values: string[] }[]): Record<string, string>[] {
  return options.reduce<Record<string, string>[]>(
    (acc, o) => acc.flatMap((combo) => o.values.map((v) => ({ ...combo, [o.name]: v }))),
    [{}],
  );
}

export const productListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  categoryId: uuid.optional(),
  brandId: uuid.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const mediaUpdateSchema = z.strictObject({
  altAr: optText(200).optional(),
  altEn: optText(200).optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

export const RELATION_TYPES = ['RELATED', 'UPSELL', 'CROSS_SELL'] as const;
export const relationsSchema = z.strictObject({
  type: z.enum(RELATION_TYPES),
  productIds: z.array(uuid).max(20).refine((v) => new Set(v).size === v.length, { message: 'duplicate_products' }),
});

export const ADJUST_REASONS = ['RESTOCK', 'ADJUSTMENT', 'DAMAGE', 'RETURN', 'CORRECTION'] as const;
export const inventoryAdjustSchema = z
  .strictObject({
    variantId: uuid,
    /** Relative change (+5, -2)... */
    delta: z.number().int().min(-10_000_000).max(10_000_000).optional(),
    /** ...or an absolute count after a stock take. Exactly one of the two. */
    setTo: z.number().int().min(0).max(10_000_000).optional(),
    reason: z.enum(ADJUST_REASONS),
    note: optText(300),
  })
  .refine((v) => (v.delta === undefined) !== (v.setTo === undefined), { message: 'delta_or_set_to' })
  .refine((v) => v.delta !== 0, { message: 'zero_delta' });
export type InventoryAdjustInput = z.infer<typeof inventoryAdjustSchema>;

export const inventoryListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  lowStock: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const movementsQuerySchema = z.object({
  variantId: uuid.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const IMPORT_MAX_ROWS = 1000;
export const CSV_COLUMNS = [
  'slug', 'name_ar', 'name_en', 'type', 'status', 'brand', 'categories', 'sku', 'barcode',
  'price', 'compare_at_price', 'cost', 'stock', 'low_stock_threshold',
  'option1_name', 'option1_value', 'option2_name', 'option2_value', 'option3_name', 'option3_value',
] as const;
