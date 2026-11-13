import { canTransition, checkoutSchema, deliveryFeeFor, deliveryZoneSchema, normalizePhone, ORDER_STATUSES, ORDER_TRANSITIONS } from './checkout';

describe('normalizePhone', () => {
  it('completes local Kuwait numbers and accepts international forms', () => {
    expect(normalizePhone('50001234', 'KW')).toBe('+96550001234');
    expect(normalizePhone('5000 1234', 'KW')).toBe('+96550001234');
    expect(normalizePhone('+965 5000-1234', 'KW')).toBe('+96550001234');
    expect(normalizePhone('0096550001234', 'KW')).toBe('+96550001234');
    expect(normalizePhone('96550001234', 'KW')).toBe('+96550001234');
    expect(normalizePhone('٥٠٠٠١٢٣٤', 'KW')).toBe('+96550001234');
  });
  it('handles the leading zero used in Saudi Arabia and the UAE', () => {
    expect(normalizePhone('0501234567', 'SA')).toBe('+966501234567');
    expect(normalizePhone('501234567', 'AE')).toBe('+971501234567');
  });
  it('accepts a foreign number only in international form', () => {
    expect(normalizePhone('+447911123456', 'KW')).toBe('+447911123456');
    expect(normalizePhone('07911123456', 'KW')).toBeNull();
  });
  it('rejects wrong lengths and non-numbers', () => {
    for (const bad of ['', '123', '5000123', '500012345', '+9655000123', 'abcdefgh', '5000-12a4', '+1'])
      expect(normalizePhone(bad, 'KW')).toBeNull();
  });
});

describe('delivery fee', () => {
  it('is waived from the free-delivery threshold', () => {
    expect(deliveryFeeFor({ fee: 1500, freeAbove: null }, 999_999)).toBe(1500);
    expect(deliveryFeeFor({ fee: 1500, freeAbove: 20_000 }, 19_999)).toBe(1500);
    expect(deliveryFeeFor({ fee: 1500, freeAbove: 20_000 }, 20_000)).toBe(0);
  });
  it('zone input refuses negative or fractional fees and markup in names', () => {
    const ok = { nameAr: 'حولي', nameEn: 'Hawalli', fee: 1000 };
    expect(deliveryZoneSchema.safeParse(ok).success).toBe(true);
    expect(deliveryZoneSchema.safeParse({ ...ok, fee: -1 }).success).toBe(false);
    expect(deliveryZoneSchema.safeParse({ ...ok, fee: 1.5 }).success).toBe(false);
    expect(deliveryZoneSchema.safeParse({ ...ok, nameEn: '<b>x</b>' }).success).toBe(false);
  });
});

describe('order state machine', () => {
  it('only moves forward or to cancelled, and final states are final', () => {
    expect(canTransition('PENDING', 'CONFIRMED')).toBe(true);
    expect(canTransition('PENDING', 'SHIPPED')).toBe(false);
    expect(canTransition('CONFIRMED', 'PENDING')).toBe(false);
    expect(canTransition('SHIPPED', 'DELIVERED')).toBe(true);
    for (const to of ORDER_STATUSES) {
      expect(canTransition('DELIVERED', to)).toBe(false);
      expect(canTransition('CANCELLED', to)).toBe(false);
    }
    for (const from of ORDER_STATUSES) expect(ORDER_TRANSITIONS[from]).not.toContain(from);
  });
});

describe('checkout input', () => {
  const base = {
    fulfillment: 'PICKUP', customer: { name: 'سارة', phone: '50001234' }, paymentProvider: 'cod', idempotencyKey: 'a'.repeat(32),
  };
  it('pickup needs no address; delivery needs a zone and an address', () => {
    expect(checkoutSchema.safeParse(base).success).toBe(true);
    const delivery = checkoutSchema.safeParse({ ...base, fulfillment: 'DELIVERY' });
    expect(delivery.success).toBe(false);
    expect(delivery.error!.issues.map((i) => i.message).sort()).toEqual(['address_required', 'zone_required']);
  });
  it('never accepts prices, totals or a store id from the client', () => {
    expect(checkoutSchema.safeParse({ ...base, total: 1 }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, storeId: 'x' }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, items: [] }).success).toBe(false);
  });
  it('refuses markup in free text', () => {
    expect(checkoutSchema.safeParse({ ...base, note: '<script>' }).success).toBe(false);
  });
});
