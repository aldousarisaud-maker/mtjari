/**
 * Storefront themes: ids, bilingual names and merchant-editable settings.
 * The React components of each theme live in apps/web; this file is the part
 * the API needs in order to validate and store a store's theme choices.
 */
import { z } from 'zod';

export const THEME_IDS = ['modern-electronics', 'luxury-fashion', 'perfume-boutique', 'coffee-house', 'gulf-premium'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DEFAULT_THEME_ID: ThemeId = 'gulf-premium';
export const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'invalid_color');
// Plain text only: these strings are rendered as text, never as HTML.
const text = (max: number) => z.string().trim().max(max).refine((v) => !/[<>]/.test(v), 'invalid_text');

// ---- home page sections (the visual builder edits this list) ---------
export const SECTION_TYPES = ['hero', 'products', 'categories', 'banner', 'text'] as const;
export type SectionType = (typeof SECTION_TYPES)[number];
export const MAX_SECTIONS = 12;
const sectionId = z.string().regex(/^[a-z0-9-]{1,24}$/, 'invalid_section_id');

export const sectionSchema = z.discriminatedUnion('type', [
  /** The theme's own headline block; its texts are `hero` below. At most one. */
  z.strictObject({ id: sectionId, type: z.literal('hero') }),
  /** A product grid: newest products, or one category's. */
  z.strictObject({ id: sectionId, type: z.literal('products'), titleAr: text(60), titleEn: text(60), categoryId: z.string().uuid().nullable(), limit: z.number().int().min(4).max(24) }),
  /** The top-level categories. At most one. */
  z.strictObject({ id: sectionId, type: z.literal('categories') }),
  /** A strip of text, optionally with a "shop now" button. */
  z.strictObject({ id: sectionId, type: z.literal('banner'), textAr: text(160), textEn: text(160), button: z.boolean() }),
  /** A heading and a short paragraph. */
  z.strictObject({ id: sectionId, type: z.literal('text'), titleAr: text(80), titleEn: text(80), bodyAr: text(1000), bodyEn: text(1000) }),
]);
export type Section = z.infer<typeof sectionSchema>;
export type SectionOf<T extends SectionType> = Extract<Section, { type: T }>;

export const sectionsSchema = z.array(sectionSchema).min(1).max(MAX_SECTIONS).superRefine((list, ctx) => {
  if (new Set(list.map((x) => x.id)).size !== list.length) ctx.addIssue({ code: 'custom', message: 'duplicate_section_id' });
  for (const type of ['hero', 'categories'] as const) {
    if (list.filter((x) => x.type === type).length > 1) ctx.addIssue({ code: 'custom', message: `only_one_${type}` });
  }
});

export const themeSettingsSchema = z.strictObject({
  colors: z.strictObject({ primary: hex, accent: hex }),
  /** Bar above the header. Empty = hidden. */
  announcement: z.strictObject({ ar: text(140), en: text(140) }),
  /** Home page headline. Empty title = the store name is used. */
  hero: z.strictObject({ titleAr: text(90), titleEn: text(90), subtitleAr: text(200), subtitleEn: text(200) }),
  /** The home page, top to bottom. */
  sections: sectionsSchema,
});
export type ThemeSettings = z.infer<typeof themeSettingsSchema>;

export interface ThemeManifest {
  id: ThemeId;
  name: { ar: string; en: string };
  sector: { ar: string; en: string };
  description: { ar: string; en: string };
  /** Whether the design is dark by default (used for the browser theme colour). */
  dark: boolean;
  defaults: ThemeSettings;
}

/** The layout each theme was designed around; stored settings without `sections` start from this. */
const layout = (limit: number, order: ('hero' | 'categories' | 'products')[]): Section[] => order.map((type): Section =>
  type === 'products' ? { id: 'products', type, titleAr: '', titleEn: '', categoryId: null, limit } : { id: type, type });

export const THEMES: Record<ThemeId, ThemeManifest> = {
  'modern-electronics': {
    id: 'modern-electronics',
    name: { ar: 'إلكترونيات عصرية', en: 'Modern Electronics' },
    sector: { ar: 'إلكترونيات', en: 'Electronics' },
    description: {
      ar: 'شبكة منتجات كثيفة، شريط تصنيفات علوي، وبطاقات تبرز السعر والتوفر والخصم.',
      en: 'Dense product grid, top category bar and cards that put price, availability and discount first.',
    },
    dark: false,
    defaults: {
      sections: layout(12, ['hero', 'products']),
      colors: { primary: '#2563EB', accent: '#F59E0B' },
      announcement: { ar: '', en: '' },
      hero: { titleAr: '', titleEn: '', subtitleAr: 'أحدث الأجهزة والإكسسوارات في مكان واحد', subtitleEn: 'The latest devices and accessories in one place' },
    },
  },
  'luxury-fashion': {
    id: 'luxury-fashion',
    name: { ar: 'أزياء فاخرة', en: 'Luxury Fashion' },
    sector: { ar: 'أزياء', en: 'Fashion' },
    description: {
      ar: 'تصميم تحريري بمساحات بيضاء واسعة، صور طولية كبيرة وعناوين بخط كلاسيكي.',
      en: 'Editorial layout with generous whitespace, tall imagery and classic serif headings.',
    },
    dark: false,
    defaults: {
      sections: layout(6, ['hero', 'products']),
      colors: { primary: '#111111', accent: '#A16207' },
      announcement: { ar: '', en: '' },
      hero: { titleAr: '', titleEn: '', subtitleAr: 'المجموعة الجديدة', subtitleEn: 'The new collection' },
    },
  },
  'perfume-boutique': {
    id: 'perfume-boutique',
    name: { ar: 'بوتيك العطور', en: 'Perfume Boutique' },
    sector: { ar: 'عطور', en: 'Perfume' },
    description: {
      ar: 'واجهة داكنة بلمسات ذهبية، عرض هادئ للمنتج واختيار الحجم ببطاقات أنيقة.',
      en: 'Dark interface with gold accents, calm product presentation and elegant size selection.',
    },
    dark: true,
    defaults: {
      sections: layout(8, ['hero', 'products', 'categories']),
      colors: { primary: '#C8A45C', accent: '#F3E7C9' },
      announcement: { ar: '', en: '' },
      hero: { titleAr: '', titleEn: '', subtitleAr: 'عطور مختارة بعناية', subtitleEn: 'Carefully selected fragrances' },
    },
  },
  'coffee-house': {
    id: 'coffee-house',
    name: { ar: 'بيت القهوة', en: 'Coffee House' },
    sector: { ar: 'قهوة', en: 'Coffee' },
    description: {
      ar: 'ألوان ترابية دافئة، بطاقات مستديرة وقائمة منتجات تشبه قائمة المقهى.',
      en: 'Warm earth tones, rounded cards and a product list that reads like a café menu.',
    },
    dark: false,
    defaults: {
      sections: layout(8, ['hero', 'products']),
      colors: { primary: '#6F4E37', accent: '#D97706' },
      announcement: { ar: '', en: '' },
      hero: { titleAr: '', titleEn: '', subtitleAr: 'محمّصة طازجة تصلك إلى بابك', subtitleEn: 'Freshly roasted, delivered to your door' },
    },
  },
  'gulf-premium': {
    id: 'gulf-premium',
    name: { ar: 'الخليج الفاخر', en: 'Gulf Premium' },
    sector: { ar: 'متاجر خليجية راقية', en: 'Gulf luxury' },
    description: {
      ar: 'تصميم عربي أولاً بخط كوفي، زخارف هندسية هادئة ولوحة ألوان متزنة.',
      en: 'Arabic-first design with Kufi type, quiet geometric motifs and a balanced palette.',
    },
    dark: false,
    defaults: {
      sections: layout(8, ['hero', 'categories', 'products']),
      colors: { primary: '#0F766E', accent: '#B45309' },
      announcement: { ar: '', en: '' },
      hero: { titleAr: '', titleEn: '', subtitleAr: 'أهلاً بكم في متجرنا', subtitleEn: 'Welcome to our store' },
    },
  },
};

/** Stored settings may predate newer fields: unknown keys are dropped and missing ones filled from the theme defaults. */
export function resolveThemeSettings(themeId: ThemeId, stored: unknown): ThemeSettings {
  const d = THEMES[themeId].defaults;
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  // Before the builder, the home page had one product grid set by these two fields.
  let sections: unknown = s['sections'];
  if (sections === undefined && ('featuredCategoryId' in s || 'homeProductLimit' in s)) {
    sections = d.sections.map((x) => (x.type === 'products'
      ? { ...x, categoryId: typeof s['featuredCategoryId'] === 'string' ? s['featuredCategoryId'] : null, limit: s['homeProductLimit'] ?? x.limit }
      : x));
  }
  const candidate = {
    colors: { ...d.colors, ...obj(s['colors']) },
    announcement: { ...d.announcement, ...obj(s['announcement']) },
    hero: { ...d.hero, ...obj(s['hero']) },
    sections: sections === undefined ? d.sections : sections,
  };
  const parsed = themeSettingsSchema.strip().safeParse(candidate);
  return parsed.success ? parsed.data : d;
}

export const themeDraftSchema = z.strictObject({ themeId: z.enum(THEME_IDS), settings: themeSettingsSchema });
export type ThemeDraftInput = z.infer<typeof themeDraftSchema>;
export const themePublishSchema = z.strictObject({ themeId: z.enum(THEME_IDS) });

// ---- storefront queries and cart --------------------------------------
export const STOREFRONT_SORTS = ['newest', 'price_asc', 'price_desc'] as const;
export const storefrontProductsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(120).optional(),
  sort: z.enum(STOREFRONT_SORTS).default('newest'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});
export type StorefrontProductsQuery = z.infer<typeof storefrontProductsQuerySchema>;

export const CART_MAX_LINES = 50;
export const CART_MAX_QUANTITY = 99;
export const cartAddSchema = z.strictObject({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(CART_MAX_QUANTITY).default(1) });
export const cartUpdateSchema = z.strictObject({ quantity: z.number().int().min(0).max(CART_MAX_QUANTITY) });
