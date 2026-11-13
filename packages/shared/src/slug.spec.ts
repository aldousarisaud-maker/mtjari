import { checkSlug } from './slug';
import { createStoreSchema, registerSchema, updateStoreSchema } from './schemas';

describe('checkSlug', () => {
  it.each(['abc', 'my-store', 'store123', 'a1b2-c3'])('accepts %s', (s) => {
    expect(checkSlug(s)).toEqual({ ok: true });
  });

  it.each(['ab', '-abc', 'abc-', 'a--b', 'my_store', 'متجر', 'a'.repeat(41), 'has space'])(
    'rejects format %s',
    (s) => {
      expect(checkSlug(s)).toEqual({ ok: false, reason: 'format' });
    },
  );

  it.each(['www', 'admin', 'api', 'mtjari'])('rejects reserved %s', (s) => {
    expect(checkSlug(s)).toEqual({ ok: false, reason: 'reserved' });
  });

  it('normalises case and whitespace', () => {
    expect(checkSlug('  MyStore ')).toEqual({ ok: true });
  });
});

describe('schemas', () => {
  it('lowercases email and enforces password length', () => {
    const ok = registerSchema.safeParse({ email: ' A@B.CO ', password: 'x'.repeat(10), name: 'S' });
    expect(ok.success && ok.data.email).toBe('a@b.co');
    expect(registerSchema.safeParse({ email: 'a@b.co', password: 'short', name: 'S' }).success).toBe(false);
  });

  it('normalises slug and applies Kuwait defaults', () => {
    const r = createStoreSchema.parse({ name: 'My Store', slug: 'My-Store' });
    expect(r).toMatchObject({ slug: 'my-store', country: 'KW', currency: 'KWD', defaultLocale: 'ar' });
  });

  it('store updates never inject defaults and reject immutable fields', () => {
    expect(updateStoreSchema.parse({ name: 'New name' })).toEqual({ name: 'New name' });
    expect(updateStoreSchema.safeParse({ slug: 'changed' }).success).toBe(false);
    expect(updateStoreSchema.safeParse({}).success).toBe(false);
  });
});
