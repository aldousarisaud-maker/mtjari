/**
 * Checkout, delivery and orders: validation shared by the API and the web
 * tier, the order state machine and phone number rules for GCC countries.
 */
import { z } from 'zod';

// Plain text only: these strings are rendered as text, never as HTML.
const text = (max: number) => z.string().trim().max(max).refine((v) => !/[<>]/.test(v), 'invalid_text');
const amount = z.number().int().min(0).max(1_000_000_000);

// ---- delivery -----------------------------------------------------------
export const deliveryZoneSchema = z.strictObject({
  nameAr: text(80).min(1, 'zone_name_required'),
  nameEn: text(80).min(1, 'zone_name_required'),
  fee: amount,
  /** Subtotal from which delivery is free; null = never free. */
  freeAbove: amount.nullable().default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type DeliveryZoneInput = z.infer<typeof deliveryZoneSchema>;

/** The six governorates of Kuwait, offered as a one-click starting point for delivery zones. */
export const KUWAIT_GOVERNORATES = [
  { nameAr: 'العاصمة', nameEn: 'Capital' },
  { nameAr: 'حولي', nameEn: 'Hawalli' },
  { nameAr: 'الفروانية', nameEn: 'Farwaniya' },
  { nameAr: 'مبارك الكبير', nameEn: 'Mubarak Al-Kabeer' },
  { nameAr: 'الأحمدي', nameEn: 'Ahmadi' },
  { nameAr: 'الجهراء', nameEn: 'Jahra' },
] as const;

export const kuwaitZonesSchema = z.strictObject({ fee: amount });

export function deliveryFeeFor(zone: { fee: number; freeAbove: number | null }, subtotal: number): number {
  return zone.freeAbove != null && subtotal >= zone.freeAbove ? 0 : zone.fee;
}

export const checkoutSettingsSchema = z.strictObject({
  pickupEnabled: z.boolean(),
  pickupInstructionsAr: text(500).default(''),
  pickupInstructionsEn: text(500).default(''),
  minOrderAmount: amount.default(0),
});
export type CheckoutSettingsInput = z.infer<typeof checkoutSettingsSchema>;

// ---- payment methods ----------------------------------------------------
export const paymentMethodUpdateSchema = z.strictObject({
  enabled: z.boolean(),
  /** Only sent when the merchant enters or replaces credentials; never returned by the API. */
  credentials: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/), z.string().trim().min(1).max(2000)).optional(),
});
export type PaymentMethodUpdateInput = z.infer<typeof paymentMethodUpdateSchema>;

// ---- phone numbers ------------------------------------------------------
/** Dial code and national number length for the countries stores can be based in. */
export const PHONE_RULES: Record<string, { dial: string; length: number }> = {
  KW: { dial: '965', length: 8 },
  SA: { dial: '966', length: 9 },
  AE: { dial: '971', length: 9 },
  BH: { dial: '973', length: 8 },
  QA: { dial: '974', length: 8 },
  OM: { dial: '968', length: 8 },
};

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Returns the number in +E.164 form, or null when it is not a plausible
 * number. A local number is completed with the store country's dial code.
 */
export function normalizePhone(raw: string, country: string): string | null {
  let s = raw.trim().replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))).replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!/^\+?\d+$/.test(s)) return null;
  const rule = PHONE_RULES[country];
  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (rule && digits.startsWith(rule.dial)) return digits.length === rule.dial.length + rule.length ? s : null;
    return digits.length >= 8 && digits.length <= 15 ? s : null;
  }
  if (!rule) return null;
  // National format, with or without a leading zero (05xxxxxxxx in Saudi Arabia and the UAE).
  if (s.length === rule.length + 1 && s.startsWith('0')) s = s.slice(1);
  if (s.startsWith(rule.dial) && s.length === rule.dial.length + rule.length) return `+${s}`;
  return s.length === rule.length ? `+${rule.dial}${s}` : null;
}

// ---- placing an order ---------------------------------------------------
export const addressSchema = z.strictObject({
  area: text(80).min(1, 'address_required'),
  block: text(20).min(1, 'address_required'),
  street: text(80).min(1, 'address_required'),
  avenue: text(40).default(''),
  building: text(40).min(1, 'address_required'),
  floor: text(20).default(''),
  apartment: text(20).default(''),
  directions: text(300).default(''),
});
export type AddressInput = z.infer<typeof addressSchema>;

export const checkoutSchema = z
  .strictObject({
    fulfillment: z.enum(['DELIVERY', 'PICKUP']),
    zoneId: z.string().uuid().optional(),
    address: addressSchema.optional(),
    customer: z.strictObject({
      name: text(100).min(2, 'name_required'),
      phone: z.string().trim().min(1, 'phone_required').max(30),
      email: z.union([z.literal(''), z.string().trim().toLowerCase().email('invalid_email').max(200)]).default(''),
    }),
    note: text(500).default(''),
    paymentProvider: z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/),
    locale: z.enum(['ar', 'en']).default('ar'),
    /** Generated once per checkout page; a double submit returns the same order. */
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  })
  .superRefine((v, ctx) => {
    if (v.fulfillment === 'DELIVERY') {
      if (!v.zoneId) ctx.addIssue({ code: 'custom', path: ['zoneId'], message: 'zone_required' });
      if (!v.address) ctx.addIssue({ code: 'custom', path: ['address'], message: 'address_required' });
    }
  });
export type CheckoutInput = z.infer<typeof checkoutSchema>;

// ---- order state machine ------------------------------------------------
export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;
export type OrderStatusName = (typeof ORDER_STATUSES)[number];

/** Allowed moves. DELIVERED and CANCELLED are final. */
export const ORDER_TRANSITIONS: Record<OrderStatusName, readonly OrderStatusName[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};
export const canTransition = (from: OrderStatusName, to: OrderStatusName) => ORDER_TRANSITIONS[from].includes(to);

export const orderTransitionSchema = z.strictObject({ to: z.enum(ORDER_STATUSES), note: text(500).default('') });
export const orderNoteSchema = z.strictObject({ note: text(500).min(1, 'note_required') });
export const ordersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type OrdersQuery = z.infer<typeof ordersQuerySchema>;
