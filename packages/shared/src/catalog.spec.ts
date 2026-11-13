import { generateVariantMatrix, inventoryAdjustSchema, productCreateSchema, slugify, validateVariantMatrix } from './catalog';
import { csvField, parseCsv, parseCsvRecords, toCsv } from './csv';
import { formatMoney, fromMinor, marginPercent, toMinor } from './money';
import { PERMISSIONS, resolveRolePermissions } from './permissions';

describe('money', () => {
  it('parses to minor units per currency without float errors', () => {
    expect(toMinor('1.250', 'KWD')).toBe(1250);
    expect(toMinor('0.1', 'KWD')).toBe(100);
    expect(toMinor('19.99', 'SAR')).toBe(1999);
    expect(toMinor('1,250.5', 'AED')).toBe(125050);
    expect(toMinor('١٢٫٥', 'KWD')).toBe(12500);
    expect(toMinor(4.35, 'SAR')).toBe(435); // 4.35 * 100 = 434.99999 in floats
    expect(toMinor('7', 'BHD')).toBe(7000);
  });
  it('rejects invalid amounts', () => {
    for (const bad of ['', 'abc', '-1', '1.2.3', '1.2345', '99999999999']) expect(toMinor(bad, 'KWD')).toBeNull();
    expect(toMinor('1.999', 'SAR')).toBeNull(); // too many decimals for a 2-decimal currency
    expect(() => toMinor('1', 'XYZ')).toThrow();
  });
  it('formats back', () => {
    expect(fromMinor(1250, 'KWD')).toBe('1.250');
    expect(fromMinor(5, 'SAR')).toBe('0.05');
    expect(formatMoney(12500, 'KWD', 'en')).toContain('12.500');
    expect(marginPercent(1000, 600)).toBe(40);
    expect(marginPercent(0, 10)).toBeNull();
    expect(marginPercent(1000, null)).toBeNull();
  });
});

describe('slugify', () => {
  it('keeps Arabic and Latin letters, drops punctuation and diacritics', () => {
    expect(slugify('عطر الورد 50ml!')).toBe('عطر-الورد-50ml');
    expect(slugify('  iPhone 15 Pro — Max ')).toBe('iphone-15-pro-max');
    expect(slugify('قَهْوَة')).toBe('قهوة');
    expect(slugify('!!!')).toBe('');
  });
});

describe('variants', () => {
  const options = [{ name: 'Color', values: ['Red', 'Blue'] }, { name: 'Size', values: ['S', 'M', 'L'] }];
  it('generates the full matrix', () => {
    const m = generateVariantMatrix(options);
    expect(m).toHaveLength(6);
    expect(m[0]).toEqual({ Color: 'Red', Size: 'S' });
    expect(generateVariantMatrix([])).toEqual([{}]);
  });
  it('validates the matrix against type and options', () => {
    const all = generateVariantMatrix(options).map((optionValues) => ({ optionValues }));
    expect(validateVariantMatrix('VARIANT', options, all)).toBeNull();
    expect(validateVariantMatrix('VARIANT', options, [...all, all[0]!])).toBe('duplicate_variant');
    expect(validateVariantMatrix('VARIANT', options, [{ optionValues: { Color: 'Green', Size: 'S' } }])).toBe('variant_options_mismatch');
    expect(validateVariantMatrix('VARIANT', options, [{ optionValues: { Color: 'Red' } }])).toBe('variant_options_mismatch');
    expect(validateVariantMatrix('VARIANT', [], [{ optionValues: {} }])).toBe('options_required');
    expect(validateVariantMatrix('SIMPLE', [], [{ optionValues: {} }])).toBeNull();
    expect(validateVariantMatrix('SIMPLE', options, [{ optionValues: {} }])).toBe('options_not_allowed');
    expect(validateVariantMatrix('DIGITAL', [], [{ optionValues: {} }, { optionValues: {} }])).toBe('single_variant_required');
    expect(validateVariantMatrix('VARIANT', options, all.map((v) => ({ ...v, sku: 'SAME' })))).toBe('duplicate_sku');
  });
  it('product schema requires a name and a sane compare-at price', () => {
    const base = { variants: [{ price: 1000 }] };
    expect(productCreateSchema.safeParse(base).success).toBe(false);
    expect(productCreateSchema.safeParse({ ...base, nameAr: 'منتج' }).success).toBe(true);
    expect(productCreateSchema.safeParse({ nameEn: 'P', variants: [{ price: 1000, compareAtPrice: 900 }] }).success).toBe(false);
    expect(productCreateSchema.safeParse({ nameEn: 'P', variants: [{ price: 1000.5 }] }).success).toBe(false);
    expect(productCreateSchema.safeParse({ nameEn: 'P', storeId: 'x', variants: [{ price: 1 }] }).success).toBe(false);
  });
  it('inventory adjustment needs exactly one of delta / setTo', () => {
    const v = '11111111-1111-4111-8111-111111111111';
    expect(inventoryAdjustSchema.safeParse({ variantId: v, delta: 5, reason: 'RESTOCK' }).success).toBe(true);
    expect(inventoryAdjustSchema.safeParse({ variantId: v, setTo: 0, reason: 'CORRECTION' }).success).toBe(true);
    expect(inventoryAdjustSchema.safeParse({ variantId: v, delta: 5, setTo: 3, reason: 'RESTOCK' }).success).toBe(false);
    expect(inventoryAdjustSchema.safeParse({ variantId: v, reason: 'RESTOCK' }).success).toBe(false);
    expect(inventoryAdjustSchema.safeParse({ variantId: v, delta: 0, reason: 'RESTOCK' }).success).toBe(false);
    expect(inventoryAdjustSchema.safeParse({ variantId: v, delta: 1, reason: 'SALE' }).success).toBe(false);
  });
});

describe('csv', () => {
  it('parses quotes, escaped quotes, embedded newlines, CRLF and BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n"line1\nline2",z\n\n')).toEqual([
      ['a', 'b'], ['x, y', 'he said "hi"'], ['line1\nline2', 'z'],
    ]);
    expect(() => parseCsv('a,"unterminated')).toThrow('csv_unterminated_quote');
  });
  it('reads records by header and round-trips', () => {
    const csv = toCsv(['Name', 'Note'], [['عطر', 'a,b'], ['x', 'q"q']]);
    expect(parseCsvRecords(csv).records).toEqual([{ name: 'عطر', note: 'a,b' }, { name: 'x', note: 'q"q' }]);
  });
  it('neutralises spreadsheet formulas but keeps negative numbers', () => {
    expect(csvField('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvField('@cmd')).toBe("'@cmd");
    expect(csvField('-5')).toBe('-5');
    expect(csvField(null)).toBe('');
  });
});

describe('resolveRolePermissions', () => {
  it('built-in roles follow the code template, so new permissions reach old stores', () => {
    const stale = { key: 'staff', isSystem: true, permissions: ['store:read'] };
    expect(resolveRolePermissions(stale)).toContain(PERMISSIONS.INVENTORY_WRITE);
  });
  it('custom roles use their stored list and ignore unknown strings', () => {
    expect(resolveRolePermissions({ key: null, isSystem: false, permissions: ['products:read', 'nope'] })).toEqual(['products:read']);
  });
});
