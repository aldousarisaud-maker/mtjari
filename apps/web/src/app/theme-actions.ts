'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isThemeId } from '@mtjari/shared';
import type { ActionState } from '@/components/action-form';
import { api } from '@/lib/api';
import { errorText, isLocale, t, type Locale } from '@/lib/i18n';
import { shopOrigin } from '@/storefront/api';

const str = (f: FormData, k: string) => (f.get(k) ?? '').toString().trim();
const loc = (f: FormData): Locale => (isLocale(str(f, 'locale')) ? (str(f, 'locale') as Locale) : 'ar');
const UUID = /^[0-9a-f-]{36}$/i;
const storeId = (f: FormData) => {
  const v = str(f, 'storeId');
  if (!UUID.test(v)) throw new Error('bad storeId');
  return v;
};
const themeId = (f: FormData) => {
  const v = str(f, 'themeId');
  if (!isThemeId(v)) throw new Error('bad themeId');
  return v;
};
const page = (f: FormData) => `/${loc(f)}/dashboard/${storeId(f)}/theme`;

/** Opens the storefront in preview mode: a short-lived token lets this member see the unpublished theme. */
async function openPreview(f: FormData): Promise<ActionState> {
  const l = loc(f);
  const [token, overview] = await Promise.all([
    api<{ token: string }>(`/v1/stores/${storeId(f)}/theme/preview-token`, { method: 'POST', body: { themeId: themeId(f) } }),
    api<{ host: string | null }>(`/v1/stores/${storeId(f)}/theme`),
  ]);
  if (!token.ok || !overview.ok || !overview.data.host) return { error: errorText(l, token.code ?? overview.code) };
  redirect(`${await shopOrigin(overview.data.host)}/${l}?preview=${encodeURIComponent(token.data.token)}`);
}

export async function previewThemeAction(_: ActionState, f: FormData): Promise<ActionState> {
  return openPreview(f);
}

export async function publishThemeAction(_: ActionState, f: FormData): Promise<ActionState> {
  const res = await api(`/v1/stores/${storeId(f)}/theme/publish`, { method: 'POST', body: { themeId: themeId(f) } });
  if (!res.ok) return { error: errorText(loc(f), res.code) };
  revalidatePath(page(f));
  return { ok: t(loc(f), 'th.publishedOk') };
}

export async function launchStoreAction(_: ActionState, f: FormData): Promise<ActionState> {
  const res = await api(`/v1/stores/${storeId(f)}/${str(f, 'intent') === 'unlaunch' ? 'unlaunch' : 'launch'}`, { method: 'POST' });
  if (!res.ok) return { error: errorText(loc(f), res.code) };
  revalidatePath(`/${loc(f)}/dashboard/${storeId(f)}`, 'layout');
  return {};
}
