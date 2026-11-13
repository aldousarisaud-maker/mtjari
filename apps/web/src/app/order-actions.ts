'use server';

import { revalidatePath } from 'next/cache';
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
const path = (f: FormData, rest = '') => `/${loc(f)}/dashboard/${id(f, 'storeId')}${rest}`;

/** API error → message. Validation errors name the rule that failed. */
function fail(l: Locale, res: { code?: string; data: unknown }): ActionState {
  const issue = (res.data as { issues?: { message?: string }[] } | null)?.issues?.[0]?.message;
  return { error: errorText(l, issue && /^[a-z_]+$/.test(issue) ? issue : res.code) };
}

async function currency(storeId: string): Promise<string | null> {
  const res = await api<{ currency: string }>(`/v1/stores/${storeId}`);
  return res.ok ? res.data.currency : null;
}

// ---- orders -------------------------------------------------------------
export async function transitionOrderAction(_: ActionState, f: FormData): Promise<ActionState> {
  const res = await api(`/v1/stores/${id(f, 'storeId')}/orders/${id(f, 'orderId')}/transition`, { method: 'POST', body: { to: str(f, 'to'), note: str(f, 'note') } });
  if (!res.ok) return fail(loc(f), res);
  revalidatePath(path(f, '/orders'), 'layout');
  return {};
}

export async function recordPaymentAction(_: ActionState, f: FormData): Promise<ActionState> {
  const res = await api(`/v1/stores/${id(f, 'storeId')}/orders/${id(f, 'orderId')}/record-payment`, { method: 'POST' });
  if (!res.ok) return fail(loc(f), res);
  revalidatePath(path(f, '/orders'), 'layout');
  return {};
}

export async function addOrderNoteAction(_: ActionState, f: FormData): Promise<ActionState> {
  const res = await api(`/v1/stores/${id(f, 'storeId')}/orders/${id(f, 'orderId')}/notes`, { method: 'POST', body: { note: str(f, 'note') } });
  if (!res.ok) return fail(loc(f), res);
  revalidatePath(path(f, '/orders'), 'layout');
  return {};
}

// ---- delivery zones -----------------------------------------------------
async function zoneBody(f: FormData): Promise<{ body: Record<string, unknown> } | { code: string }> {
  const cur = await currency(id(f, 'storeId'));
  if (!cur) return { code: 'generic' };
  const fee = toMinor(str(f, 'fee'), cur);
  const freeRaw = str(f, 'freeAbove');
  const freeAbove = freeRaw ? toMinor(freeRaw, cur) : null;
  if (fee === null || (freeRaw && freeAbove === null)) return { code: 'invalid_amount' };
  return { body: { nameAr: str(f, 'nameAr'), nameEn: str(f, 'nameEn'), fee, freeAbove, isActive: f.get('isActive') !== null } };
}

export async function createZoneAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const z = await zoneBody(f);
  if ('code' in z) return { error: errorText(l, z.code) };
  const res = await api(`/v1/stores/${id(f, 'storeId')}/delivery-zones`, { method: 'POST', body: z.body });
  if (!res.ok) return fail(l, res);
  revalidatePath(path(f, '/delivery'));
  return { ok: t(l, 'd.zoneSaved') };
}

export async function updateZoneAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const z = await zoneBody(f);
  if ('code' in z) return { error: errorText(l, z.code) };
  const res = await api(`/v1/stores/${id(f, 'storeId')}/delivery-zones/${id(f, 'zoneId')}`, { method: 'PUT', body: z.body });
  if (!res.ok) return fail(l, res);
  revalidatePath(path(f, '/delivery'));
  return { ok: t(l, 'd.zoneSaved') };
}

export async function deleteZoneAction(_: ActionState, f: FormData): Promise<ActionState> {
  const res = await api(`/v1/stores/${id(f, 'storeId')}/delivery-zones/${id(f, 'zoneId')}`, { method: 'DELETE' });
  if (!res.ok) return fail(loc(f), res);
  revalidatePath(path(f, '/delivery'));
  return {};
}

export async function addKuwaitZonesAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const cur = await currency(id(f, 'storeId'));
  const fee = cur ? toMinor(str(f, 'fee'), cur) : null;
  if (fee === null) return { error: errorText(l, 'invalid_amount') };
  const res = await api<{ added: number }>(`/v1/stores/${id(f, 'storeId')}/delivery-zones/kuwait`, { method: 'POST', body: { fee } });
  if (!res.ok) return fail(l, res);
  revalidatePath(path(f, '/delivery'));
  return { ok: t(l, res.data.added ? 'd.kuwaitAdded' : 'd.kuwaitNone') };
}

// ---- checkout options and payment methods -------------------------------
export async function saveCheckoutSettingsAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const cur = await currency(id(f, 'storeId'));
  const minRaw = str(f, 'minOrderAmount');
  const minOrderAmount = !minRaw ? 0 : cur ? toMinor(minRaw, cur) : null;
  if (minOrderAmount === null) return { error: errorText(l, 'invalid_amount') };
  const res = await api(`/v1/stores/${id(f, 'storeId')}/checkout-settings`, {
    method: 'PUT',
    body: { pickupEnabled: f.get('pickupEnabled') !== null, pickupInstructionsAr: str(f, 'pickupInstructionsAr'), pickupInstructionsEn: str(f, 'pickupInstructionsEn'), minOrderAmount },
  });
  if (!res.ok) return fail(l, res);
  revalidatePath(path(f, '/delivery'));
  return { ok: t(l, 'd.optionsSaved') };
}

export async function setPaymentMethodAction(_: ActionState, f: FormData): Promise<ActionState> {
  const provider = str(f, 'provider');
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(provider)) throw new Error('bad provider');
  // Credential inputs are named cred.<field>; empty ones keep the stored value.
  const credentials: Record<string, string> = {};
  for (const [k, v] of f.entries()) {
    if (k.startsWith('cred.') && typeof v === 'string' && v.trim()) credentials[k.slice(5)] = v.trim();
  }
  const res = await api(`/v1/stores/${id(f, 'storeId')}/payment-methods/${provider}`, {
    method: 'PUT', body: { enabled: str(f, 'enabled') === 'true', ...(Object.keys(credentials).length ? { credentials } : {}) },
  });
  if (!res.ok) return fail(loc(f), res);
  revalidatePath(path(f, '/delivery'));
  return {};
}
