'use server';

import { revalidatePath } from 'next/cache';
import { isThemeId, themeSettingsSchema, type ThemeSettings } from '@mtjari/shared';
import { api } from '@/lib/api';
import { errorText, isLocale, t, type Locale } from '@/lib/i18n';
import { shopOrigin } from '@/storefront/api';

const UUID = /^[0-9a-f-]{36}$/i;
export interface BuilderResult { ok?: string; error?: string; previewUrl?: string; settings?: ThemeSettings }

const clean = (locale: string, storeId: string, themeId: string) => {
  if (!UUID.test(storeId) || !isThemeId(themeId)) return null;
  return { l: (isLocale(locale) ? locale : 'ar') as Locale, storeId, themeId };
};
const fail = (l: Locale, code?: string, data?: unknown): BuilderResult => {
  const issue = (data as { issues?: { message?: string }[] } | null)?.issues?.[0]?.message;
  return { error: errorText(l, issue && /^[a-z_]+$/.test(issue) ? issue : code) };
};
const page = (l: Locale, storeId: string) => `/${l}/dashboard/${storeId}/theme`;

/** Saves the draft the builder is holding. The API validates it again; nothing goes live. */
export async function saveDraft(locale: string, storeId: string, themeId: string, settings: unknown): Promise<BuilderResult> {
  const c = clean(locale, storeId, themeId);
  if (!c) return { error: errorText('ar', 'generic') };
  const parsed = themeSettingsSchema.safeParse(settings);
  if (!parsed.success) return fail(c.l, 'validation_failed', { issues: [{ message: parsed.error.issues[0]?.message }] });
  const res = await api(`/v1/stores/${c.storeId}/theme/draft`, { method: 'POST', body: { themeId: c.themeId, settings: parsed.data } });
  if (!res.ok) return fail(c.l, res.code, res.data);
  revalidatePath(page(c.l, c.storeId));
  return { ok: t(c.l, 'th.saved') };
}

/** A short-lived address of the home page showing the saved draft, for the builder's preview frame. */
export async function previewUrl(locale: string, storeId: string, themeId: string): Promise<BuilderResult> {
  const c = clean(locale, storeId, themeId);
  if (!c) return { error: errorText('ar', 'generic') };
  const [token, overview] = await Promise.all([
    api<{ token: string }>(`/v1/stores/${c.storeId}/theme/preview-token`, { method: 'POST', body: { themeId: c.themeId } }),
    api<{ host: string | null }>(`/v1/stores/${c.storeId}/theme`),
  ]);
  if (!token.ok || !overview.ok || !overview.data.host) return { error: errorText(c.l, token.code ?? overview.code) };
  return { previewUrl: `${await shopOrigin(overview.data.host)}/${c.l}?pv=${encodeURIComponent(token.data.token)}` };
}

export async function publishDraft(locale: string, storeId: string, themeId: string): Promise<BuilderResult> {
  const c = clean(locale, storeId, themeId);
  if (!c) return { error: errorText('ar', 'generic') };
  const res = await api(`/v1/stores/${c.storeId}/theme/publish`, { method: 'POST', body: { themeId: c.themeId } });
  if (!res.ok) return fail(c.l, res.code, res.data);
  revalidatePath(page(c.l, c.storeId));
  return { ok: t(c.l, 'th.publishedOk') };
}

export interface VersionRow { id: string; createdAt: string; createdBy: string | null; sections: string[]; colors: { primary: string; accent: string } }

export async function listVersions(locale: string, storeId: string, themeId: string): Promise<{ versions: VersionRow[] }> {
  const c = clean(locale, storeId, themeId);
  if (!c) return { versions: [] };
  const res = await api<VersionRow[]>(`/v1/stores/${c.storeId}/theme/versions/${c.themeId}`);
  return { versions: res.ok ? res.data : [] };
}

/** Loads an older published version into the draft and returns it so the builder can show it. */
export async function restoreVersion(locale: string, storeId: string, themeId: string, versionId: string): Promise<BuilderResult> {
  const c = clean(locale, storeId, themeId);
  if (!c || !UUID.test(versionId)) return { error: errorText('ar', 'generic') };
  const res = await api(`/v1/stores/${c.storeId}/theme/versions/${c.themeId}/${versionId}/restore`, { method: 'POST' });
  if (!res.ok) return fail(c.l, res.code, res.data);
  const overview = await api<{ themes: { id: string; draft: ThemeSettings }[] }>(`/v1/stores/${c.storeId}/theme`);
  const draft = overview.ok ? overview.data.themes.find((x) => x.id === c.themeId)?.draft : undefined;
  revalidatePath(page(c.l, c.storeId));
  return { ok: t(c.l, 'tb.restored'), settings: draft };
}
