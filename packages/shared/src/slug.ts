/**
 * Store subdomain rules: storename.mtjari.cc
 * - 3..40 chars, lowercase a-z, 0-9 and single hyphens, no leading/trailing hyphen
 * - not a reserved platform name
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www', 'app', 'api', 'admin', 'dashboard', 'merchant', 'merchants', 'store', 'stores',
  'shop', 'checkout', 'pay', 'payment', 'payments', 'billing', 'auth', 'login', 'signup',
  'register', 'account', 'accounts', 'help', 'support', 'docs', 'blog', 'status', 'mail',
  'email', 'smtp', 'imap', 'pop', 'ftp', 'cdn', 'static', 'assets', 'media', 'img', 'images',
  'files', 'dev', 'staging', 'test', 'demo', 'preview', 'themes', 'templates', 'partners',
  'webhook', 'webhooks', 'ns1', 'ns2', 'mtjari', 'root', 'system', 'superadmin', 'security',
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,38}[a-z0-9]$/;

export type SlugCheck = { ok: true } | { ok: false; reason: 'format' | 'reserved' };

export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase();
}

export function checkSlug(input: string): SlugCheck {
  const slug = normalizeSlug(input);
  if (!SLUG_RE.test(slug)) return { ok: false, reason: 'format' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'reserved' };
  return { ok: true };
}
