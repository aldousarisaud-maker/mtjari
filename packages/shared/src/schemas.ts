import { z } from 'zod';
import { checkSlug, normalizeSlug } from './slug';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'invalid_email' }).max(254));

/** NIST 800-63B style: length over composition rules. */
export const passwordSchema = z
  .string()
  .min(10, { message: 'password_too_short' })
  .max(128, { message: 'password_too_long' });

export const localeSchema = z.enum(['ar', 'en']);
export type Locale = z.infer<typeof localeSchema>;

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(120),
  locale: localeSchema.default('ar'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  mfaCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  recoveryCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{5}-[0-9a-f]{5}$/)
    .optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });
export const resendVerificationSchema = z.object({ email: emailSchema });
export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(400) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export const mfaCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const mfaDisableSchema = z.object({ code: z.string().regex(/^\d{6}$/), password: z.string().min(1).max(128) });

export const slugSchema = z
  .string()
  .transform(normalizeSlug)
  .superRefine((value, ctx) => {
    const res = checkSlug(value);
    if (!res.ok) ctx.addIssue({ code: 'custom', message: `slug_${res.reason}` });
  });

export const BUSINESS_TYPES = [
  'electronics', 'gaming', 'fashion', 'beauty', 'perfume', 'jewelry', 'coffee', 'food',
  'home', 'mobile', 'sports', 'baby', 'pets', 'books', 'digital', 'auto', 'flowers',
  'watches', 'health', 'grocery', 'handmade', 'multi', 'other',
] as const;

export const GCC_COUNTRIES = ['KW', 'SA', 'AE', 'BH', 'QA', 'OM'] as const;
export const GCC_CURRENCIES = ['KWD', 'SAR', 'AED', 'BHD', 'QAR', 'OMR'] as const;

const storeFields = {
  name: z.string().trim().min(2).max(80),
  businessType: z.enum(BUSINESS_TYPES),
  country: z.enum(GCC_COUNTRIES),
  currency: z.enum(GCC_CURRENCIES),
  defaultLocale: localeSchema,
};

export const createStoreSchema = z.object({
  name: storeFields.name,
  slug: slugSchema,
  businessType: storeFields.businessType.default('other'),
  country: storeFields.country.default('KW'),
  currency: storeFields.currency.default('KWD'),
  defaultLocale: storeFields.defaultLocale.default('ar'),
});
export type CreateStoreInput = z.infer<typeof createStoreSchema>;

// No defaults here: a PATCH must only touch the fields that were sent.
// Strict, so attempts to change immutable fields (slug, status...) are rejected.
export const updateStoreSchema = z
  .strictObject(storeFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty_update' });
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;

export const inviteMemberSchema = z.object({
  email: emailSchema,
  roleId: z.uuid(),
});

export const updateMemberSchema = z.object({ roleId: z.uuid() });

export const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  permissions: z.array(z.string()).max(200),
});

export const auditQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().max(80).optional(),
});
