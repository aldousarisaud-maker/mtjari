'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toMinor } from '@mtjari/shared';
import type { ActionState } from '@/components/action-form';
import { api } from '@/lib/api';
import { errorText, isLocale, t, type Locale } from '@/lib/i18n';

const str = (f: FormData, k: string) => (f.get(k) ?? '').toString().trim();
const loc = (f: FormData): Locale => (isLocale(str(f, 'locale')) ? (str(f, 'locale') as Locale) : 'ar');
const UUID = /^[0-9a-f-]{36}$/i;
const id = (f: FormData, k: string) => {
  const v = str(f, k);
  if (!UUID.test(v)) throw new Error(`bad ${k}`);
  return v;
};
const fail = (l: Locale, code?: string): ActionState => ({ error: errorText(l, code) });
const path = (f: FormData, rest = '') => `/${loc(f)}/dashboard/${id(f, 'storeId')}${rest}`;

async function storeCurrency(storeId: string): Promise<string | null> {
  const res = await api<{ currency: string }>(`/v1/stores/${storeId}`);
  return res.ok ? res.data.currency : null;
}

interface VariantRow {
  id?: string; optionValues?: Record<string, string>; sku?: string; barcode?: string;
  price?: string; compareAtPrice?: string; cost?: string; trackInventory?: boolean; lowStockThreshold?: string; initialStock?: string;
}

/** Converts the editor's text fields to the API shape (money → minor units). Returns an error code on bad input. */
function toVariants(rows: VariantRow[], currency: string): { variants: unknown[] } | { code: string } {
  const out: unknown[] = [];
  for (const r of rows) {
    const price = toMinor(r.price ?? '', currency);
    if (price === null) return { code: 'invalid_price' };
    const opt = (v: string | undefined) => (v ? toMinor(v, currency) : null);
    const compareAtPrice = opt(r.compareAtPrice);
    const cost = opt(r.cost);
    if ((r.compareAtPrice && compareAtPrice === null) || (r.cost && cost === null)) return { code: 'invalid_price' };
    const int = (v: string | undefined) => (v && /^\d{1,8}$/.test(v) ? Number(v) : null);
    out.push({
      ...(r.id ? { id: r.id } : {}),
      optionValues: r.optionValues ?? {}, sku: r.sku || null, barcode: r.barcode || null,
      price, compareAtPrice, cost, trackInventory: r.trackInventory !== false,
      lowStockThreshold: int(r.lowStockThreshold), initialStock: int(r.initialStock) ?? 0,
    });
  }
  return { variants: out };
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function details(f: FormData) {
  const brandId = str(f, 'brandId');
  return {
    nameAr: str(f, 'nameAr') || null, nameEn: str(f, 'nameEn') || null,
    descriptionAr: str(f, 'descriptionAr') || null, descriptionEn: str(f, 'descriptionEn') || null,
    status: str(f, 'status') || 'DRAFT', brandId: brandId || null,
    categoryIds: f.getAll('categoryIds').map(String),
    tags: str(f, 'tags').split(/[,،]/).map((s) => s.trim()).filter(Boolean),
    seoTitle: str(f, 'seoTitle') || null, seoDescription: str(f, 'seoDescription') || null,
  };
}

export async function createProductAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const storeId = id(f, 'storeId');
  const currency = await storeCurrency(storeId);
  if (!currency) return fail(l);
  const v = toVariants(parseJson<VariantRow[]>(str(f, 'variantsJson'), []), currency);
  if ('code' in v) return fail(l, v.code);
  const res = await api<{ id: string }>(`/v1/stores/${storeId}/products`, {
    method: 'POST',
    body: { ...details(f), type: str(f, 'type') || 'SIMPLE', options: parseJson(str(f, 'optionsJson'), []), variants: v.variants },
  });
  if (!res.ok) return fail(l, res.code);
  revalidatePath(path(f, '/products'));
  redirect(path(f, `/products/${res.data.id}`));
}

export async function updateProductAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const slug = str(f, 'slug');
  const res = await api(`/v1/stores/${id(f, 'storeId')}/products/${id(f, 'productId')}`, { method: 'PATCH', body: { ...details(f), ...(slug ? { slug } : {}) } });
  if (!res.ok) return fail(l, res.code);
  revalidatePath(path(f, '/products'), 'layout');
  return { ok: t(l, 'p.saved') };
}

export async function replaceVariantsAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const storeId = id(f, 'storeId');
  const currency = await storeCurrency(storeId);
  if (!currency) return fail(l);
  const v = toVariants(parseJson<VariantRow[]>(str(f, 'variantsJson'), []), currency);
  if ('code' in v) return fail(l, v.code);
  const res = await api(`/v1/stores/${storeId}/products/${id(f, 'productId')}/variants`, {
    method: 'PUT', body: { options: parseJson(str(f, 'optionsJson'), []), variants: v.variants },
  });
  if (!res.ok) return fail(l, res.code);
  revalidatePath(path(f, '/products'), 'layout');
  return { ok: t(l, 'p.saved') };
}

export async function deleteProductAction(_: ActionState, f: FormData): Promise<ActionState> {
  const res = await api(`/v1/stores/${id(f, 'storeId')}/products/${id(f, 'productId')}`, { method: 'DELETE' });
  if (!res.ok) return fail(loc(f), res.code);
  revalidatePath(path(f, '/products'));
  redirect(path(f, '/products'));
}

export async function uploadImageAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const file = f.get('file');
  if (!(file instanceof File) || file.size === 0) return fail(l, 'file_required');
  if (file.size > 8 * 1024 * 1024) return fail(l, 'file_too_large');
  const form = new FormData();
  form.set('file', file, 'upload');
  const alt = str(f, 'alt');
  if (alt) form.set(l === 'ar' ? 'altAr' : 'altEn', alt);
  const res = await api(`/v1/stores/${id(f, 'storeId')}/products/${id(f, 'productId')}/media`, { method: 'POST', form });
  if (!res.ok) return fail(l, res.status === 413 ? 'file_too_large' : res.code);
  revalidatePath(path(f, '/products'), 'layout');
  return {};
}

export async function deleteImageAction(_: ActionState, f: FormData): Promise<ActionState> {
  const res = await api(`/v1/stores/${id(f, 'storeId')}/products/${id(f, 'productId')}/media/${id(f, 'id')}`, { method: 'DELETE' });
  if (!res.ok) return fail(loc(f), res.code);
  revalidatePath(path(f, '/products'), 'layout');
  return {};
}

export async function createCategoryAction(_: ActionState, f: FormData): Promise<ActionState> {
  const parentId = str(f, 'parentId');
  const res = await api(`/v1/stores/${id(f, 'storeId')}/categories`, {
    method: 'POST', body: { nameAr: str(f, 'nameAr') || null, nameEn: str(f, 'nameEn') || null, parentId: parentId || null },
  });
  if (!res.ok) return fail(loc(f), res.code);
  revalidatePath(path(f, '/categories'));
  return {};
}

export async function deleteCategoryAction(_: ActionState, f: FormData): Promise<ActionState> {
  const res = await api(`/v1/stores/${id(f, 'storeId')}/categories/${id(f, 'id')}`, { method: 'DELETE' });
  if (!res.ok) return fail(loc(f), res.code);
  revalidatePath(path(f, '/categories'));
  return {};
}

export async function createBrandAction(_: ActionState, f: FormData): Promise<ActionState> {
  const res = await api(`/v1/stores/${id(f, 'storeId')}/brands`, { method: 'POST', body: { name: str(f, 'name') } });
  if (!res.ok) return fail(loc(f), res.code);
  revalidatePath(path(f, '/brands'));
  return {};
}

export async function deleteBrandAction(_: ActionState, f: FormData): Promise<ActionState> {
  const res = await api(`/v1/stores/${id(f, 'storeId')}/brands/${id(f, 'id')}`, { method: 'DELETE' });
  if (!res.ok) return fail(loc(f), res.code);
  revalidatePath(path(f, '/brands'));
  return {};
}

export async function adjustInventoryAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const raw = str(f, 'delta').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  if (!/^[+-]?\d{1,7}$/.test(raw) || Number(raw) === 0) return fail(l, 'zero_delta');
  const res = await api(`/v1/stores/${id(f, 'storeId')}/inventory/adjust`, {
    method: 'POST', body: { variantId: id(f, 'variantId'), delta: Number(raw), reason: str(f, 'reason') || 'ADJUSTMENT' },
  });
  if (!res.ok) return fail(l, res.code);
  revalidatePath(path(f, '/inventory'));
  revalidatePath(path(f), 'layout');
  return {};
}

export async function importCsvAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const file = f.get('file');
  if (!(file instanceof File) || file.size === 0) return fail(l, 'file_required');
  const form = new FormData();
  form.set('file', file, 'import.csv');
  const res = await api<{ productsCreated: number; variantsUpdated: number; errors: { row: number; message: string }[] }>(
    `/v1/stores/${id(f, 'storeId')}/products/import`, { method: 'POST', form });
  if (!res.ok) return fail(l, res.status === 413 ? 'file_too_large' : res.code);
  revalidatePath(path(f, '/products'));
  const d = res.data;
  return {
    ok: t(l, 'p.import.done').replace('{created}', String(d.productsCreated)).replace('{updated}', String(d.variantsUpdated)).replace('{errors}', String(d.errors.length)),
    data: { errors: d.errors.slice(0, 50).map((e) => ({ row: e.row, message: errorText(l, e.message) })) },
  };
}
