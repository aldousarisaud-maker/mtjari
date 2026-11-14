import { MAX_SECTIONS, THEMES, THEME_IDS, cartAddSchema, resolveThemeSettings, storefrontProductsQuerySchema, themeDraftSchema, themeSettingsSchema } from './themes';

describe('theme manifests', () => {
  it('every theme has bilingual texts and defaults that pass its own schema', () => {
    expect(THEME_IDS).toHaveLength(5);
    for (const id of THEME_IDS) {
      const m = THEMES[id];
      expect(m.id).toBe(id);
      for (const t of [m.name, m.sector, m.description]) {
        expect(t.ar.trim()).not.toBe('');
        expect(t.en.trim()).not.toBe('');
        expect(t.ar).toMatch(/[؀-ۿ]/);
      }
      expect(themeSettingsSchema.safeParse(m.defaults).success).toBe(true);
    }
    // Different designs, not one palette five times.
    expect(new Set(THEME_IDS.map((id) => THEMES[id].defaults.colors.primary)).size).toBe(5);
  });
});

describe('theme settings', () => {
  const ok = THEMES['coffee-house'].defaults;

  it('rejects markup, bad colours and unknown keys', () => {
    expect(themeSettingsSchema.safeParse({ ...ok, announcement: { ar: '<script>alert(1)</script>', en: '' } }).success).toBe(false);
    expect(themeSettingsSchema.safeParse({ ...ok, colors: { primary: 'red', accent: '#000000' } }).success).toBe(false);
    expect(themeSettingsSchema.safeParse({ ...ok, colors: { primary: '#fff;background:url(x)', accent: '#000000' } }).success).toBe(false);
    expect(themeSettingsSchema.safeParse({ ...ok, customCss: 'body{}' }).success).toBe(false);
    expect(themeDraftSchema.safeParse({ themeId: 'not-a-theme', settings: ok }).success).toBe(false);
  });

  it('fills missing fields from the theme defaults and drops unknown ones', () => {
    const s = resolveThemeSettings('coffee-house', { colors: { primary: '#123456' }, hero: { titleAr: 'قهوتنا' }, legacy: true });
    expect(s.colors).toEqual({ primary: '#123456', accent: ok.colors.accent });
    expect(s.hero.titleAr).toBe('قهوتنا');
    expect(s.hero.subtitleEn).toBe(ok.hero.subtitleEn);
    expect(s).not.toHaveProperty('legacy');
  });

  it('falls back to defaults when stored data is unusable', () => {
    expect(resolveThemeSettings('gulf-premium', null)).toEqual(THEMES['gulf-premium'].defaults);
    expect(resolveThemeSettings('gulf-premium', { colors: { primary: 'javascript:alert(1)' } })).toEqual(THEMES['gulf-premium'].defaults);
    expect(resolveThemeSettings('gulf-premium', 'garbage')).toEqual(THEMES['gulf-premium'].defaults);
  });
});

describe('home page sections', () => {
  const ok = THEMES['coffee-house'].defaults;
  const withSections = (sections: unknown) => themeSettingsSchema.safeParse({ ...ok, sections });
  const products = { id: 'p1', type: 'products', titleAr: '', titleEn: '', categoryId: null, limit: 8 };

  it('every theme starts with a hero and a product grid', () => {
    for (const id of THEME_IDS) {
      const types = THEMES[id].defaults.sections.map((x) => x.type);
      expect(types[0]).toBe('hero');
      expect(types).toContain('products');
    }
  });

  it('accepts every section type and refuses bad ones', () => {
    const all = [{ id: 'h', type: 'hero' }, products, { id: 'c', type: 'categories' }, { id: 'b', type: 'banner', textAr: 'عرض', textEn: 'Offer', button: true },
      { id: 't', type: 'text', titleAr: 'عنا', titleEn: 'About', bodyAr: 'نص', bodyEn: 'Text' }];
    expect(withSections(all).success).toBe(true);
    expect(withSections([]).success).toBe(false);
    expect(withSections(Array.from({ length: MAX_SECTIONS + 1 }, (_, i) => ({ ...products, id: `p${i}` }))).success).toBe(false);
    expect(withSections([products, { ...products }]).success).toBe(false); // duplicate id
    expect(withSections([{ id: 'a', type: 'hero' }, { id: 'b', type: 'hero' }]).success).toBe(false);
    expect(withSections([{ id: 'a', type: 'categories' }, { id: 'b', type: 'categories' }]).success).toBe(false);
    expect(withSections([{ ...products, limit: 3 }]).success).toBe(false);
    expect(withSections([{ ...products, limit: 25 }]).success).toBe(false);
    expect(withSections([{ ...products, categoryId: 'not-a-uuid' }]).success).toBe(false);
    expect(withSections([{ ...products, id: 'Bad Id!' }]).success).toBe(false);
    expect(withSections([{ id: 'x', type: 'script' }]).success).toBe(false);
    expect(withSections([{ ...products, extra: 1 }]).success).toBe(false);
    expect(withSections([{ id: 'b', type: 'banner', textAr: '<img src=x onerror=alert(1)>', textEn: '', button: false }]).success).toBe(false);
    expect(withSections([{ id: 't', type: 'text', titleAr: '', titleEn: '', bodyAr: 'x'.repeat(1001), bodyEn: '' }]).success).toBe(false);
  });

  it('settings saved before the builder keep their featured category and product count', () => {
    const categoryId = '6f1c2a34-8d1e-4c55-9f7a-0b1c2d3e4f50';
    const s = resolveThemeSettings('gulf-premium', { colors: { primary: '#123456' }, featuredCategoryId: categoryId, homeProductLimit: 12 });
    expect(s.sections.map((x) => x.type)).toEqual(['hero', 'categories', 'products']);
    expect(s.sections.find((x) => x.type === 'products')).toMatchObject({ categoryId, limit: 12 });
    // Unusable legacy values fall back to the theme's defaults instead of breaking the shop.
    expect(resolveThemeSettings('gulf-premium', { featuredCategoryId: 'x', homeProductLimit: 9999 })).toEqual(THEMES['gulf-premium'].defaults);
  });

  it('stored sections are kept as saved', () => {
    const sections = [{ id: 'b', type: 'banner', textAr: 'عرض', textEn: 'Offer', button: false }, products];
    expect(resolveThemeSettings('coffee-house', { sections }).sections).toEqual(sections);
  });
});

describe('storefront inputs', () => {
  it('bounds paging and sort', () => {
    expect(storefrontProductsQuerySchema.parse({})).toEqual({ sort: 'newest', page: 1, limit: 12 });
    expect(storefrontProductsQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(storefrontProductsQuerySchema.safeParse({ sort: 'price; DROP TABLE' }).success).toBe(false);
  });
  it('bounds cart quantities', () => {
    const variantId = '6f1c2a34-8d1e-4c55-9f7a-0b1c2d3e4f50';
    expect(cartAddSchema.parse({ variantId }).quantity).toBe(1);
    for (const quantity of [0, -1, 100, 1.5]) expect(cartAddSchema.safeParse({ variantId, quantity }).success).toBe(false);
    expect(cartAddSchema.safeParse({ variantId, quantity: 1, price: 1 }).success).toBe(false); // the client can't name a price
  });
});
