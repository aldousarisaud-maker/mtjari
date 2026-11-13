import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_THEME_ID, PERMISSIONS, isThemeId, type ThemeId, type ThemeSettings } from '@mtjari/shared';
import { launchStoreAction, previewThemeAction, publishThemeAction, saveThemeAction } from '@/app/theme-actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, Field, Input, Select, buttonClass } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, t } from '@/lib/i18n';
import { shopOrigin } from '@/storefront/api';
import { can, getStore } from '../data';
import { displayName, type CategoryOption } from '../products/product-fields';
import { RowAction } from '../row-action';

interface ThemeRow {
  id: ThemeId; name: { ar: string; en: string }; sector: { ar: string; en: string }; description: { ar: string; en: string }; dark: boolean;
  draft: ThemeSettings; published: ThemeSettings | null; isPublished: boolean; hasUnpublishedChanges: boolean;
}
interface Overview { status: string; host: string | null; publishedThemeId: ThemeId | null; publishedProducts: number; themes: ThemeRow[] }

export default async function ThemePage({ params, searchParams }: { params: Promise<{ locale: string; storeId: string }>; searchParams: Promise<{ theme?: string }> }) {
  const { locale, storeId } = await params;
  const sp = await searchParams;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  if (!can(store, PERMISSIONS.THEMES_MANAGE)) notFound();
  const [res, cats] = await Promise.all([
    api<Overview>(`/v1/stores/${store.id}/theme`),
    can(store, PERMISSIONS.PRODUCTS_READ) ? api<CategoryOption[]>(`/v1/stores/${store.id}/categories`) : null,
  ]);
  if (!res.ok) notFound();
  const o = res.data;
  const selectedId = isThemeId(sp.theme) ? sp.theme : o.publishedThemeId ?? DEFAULT_THEME_ID;
  const selected = o.themes.find((x) => x.id === selectedId)!;
  const s = selected.draft;
  const hidden = { locale: l, storeId: store.id };
  const live = o.status === 'ACTIVE';
  const canLaunch = can(store, PERMISSIONS.STORE_UPDATE);
  const url = o.host ? `${await shopOrigin(o.host)}/${l}` : null;
  const missing = [!o.publishedThemeId ? t(l, 'th.need.theme') : null, !o.publishedProducts ? t(l, 'th.need.products') : null].filter((x): x is string => !!x);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t(l, 'th.title')}</h1>

      <Card className="space-y-4" data-testid="storefront-status">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{t(l, 'th.storefront')}</h2>
          <Badge className={live ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}>{live ? t(l, 'th.live') : t(l, 'th.offline')}</Badge>
        </div>
        {o.host ? (
          <p className="text-sm text-slate-600">
            {t(l, 'th.address')}: {live && url ? <a href={url} className="font-medium text-primary underline-offset-4 hover:underline" dir="ltr">{o.host}</a> : <span dir="ltr" className="font-medium">{o.host}</span>}
          </p>
        ) : null}
        {!live ? (
          missing.length ? <ul className="list-inside list-disc text-sm text-amber-700">{missing.map((m) => <li key={m}>{m}</li>)}</ul> : <p className="text-sm text-emerald-700">{t(l, 'th.ready')}</p>
        ) : null}
        {canLaunch ? (
          <RowAction action={launchStoreAction} fields={{ ...hidden, intent: live ? 'unlaunch' : 'launch' }} label={live ? t(l, 'th.unlaunch') : t(l, 'th.launch')} variant={live ? 'danger' : 'ghost'} />
        ) : null}
      </Card>

      <section aria-labelledby="gallery" className="space-y-3">
        <h2 id="gallery" className="text-lg font-semibold">{t(l, 'th.gallery')}</h2>
        <p className="text-sm text-slate-500">{t(l, 'th.note')}</p>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {o.themes.map((th) => (
            <li key={th.id}>
              <Card className={`flex h-full flex-col gap-3 p-5 ${th.id === selectedId ? 'ring-2 ring-primary' : ''}`} data-testid={`theme-${th.id}`}>
                {/* The theme's real colours and background, not a mock screenshot. */}
                <div aria-hidden className={`flex h-20 items-end gap-2 rounded-xl p-3 ${th.dark ? 'bg-[#0d0a07]' : 'border border-slate-200 bg-white'}`}>
                  <span className="h-10 flex-1 rounded-md" style={{ background: th.draft.colors.primary }} />
                  <span className="h-6 w-10 rounded-md" style={{ background: th.draft.colors.accent }} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{th.name[l]}</h3>
                  {th.isPublished ? <Badge className="bg-emerald-100 text-emerald-700">{t(l, 'th.published')}</Badge> : null}
                  {th.hasUnpublishedChanges ? <Badge className="bg-amber-100 text-amber-700">{t(l, 'th.changes')}</Badge> : null}
                </div>
                <p className="text-xs font-medium text-primary">{th.sector[l]}</p>
                <p className="text-sm text-slate-600">{th.description[l]}</p>
                <div className="mt-auto flex flex-wrap items-start gap-2 pt-2">
                  <Link href={`/${l}/dashboard/${store.id}/theme?theme=${th.id}`} className={buttonClass({ variant: 'ghost', size: 'sm' })}>{t(l, 'th.customize')}</Link>
                  <RowAction action={previewThemeAction} fields={{ ...hidden, themeId: th.id }} label={t(l, 'th.preview')} />
                  <RowAction action={publishThemeAction} fields={{ ...hidden, themeId: th.id }} label={t(l, 'th.publish')} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <Card className="max-w-3xl">
        <h2 className="mb-4 text-lg font-semibold">{t(l, 'th.settings')}: {selected.name[l]}</h2>
        {/* key: switching theme remounts the form with that theme's stored values */}
        <ActionForm action={saveThemeAction} key={selectedId}>
          <input type="hidden" name="locale" value={l} />
          <input type="hidden" name="storeId" value={store.id} />
          <input type="hidden" name="themeId" value={selectedId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t(l, 'th.primary')} htmlFor="primary"><Input id="primary" name="primary" type="color" defaultValue={s.colors.primary} className="p-1" /></Field>
            <Field label={t(l, 'th.accent')} htmlFor="accent"><Input id="accent" name="accent" type="color" defaultValue={s.colors.accent} className="p-1" /></Field>
            <Field label={t(l, 'th.heroTitleAr')} htmlFor="heroTitleAr" hint={t(l, 'th.heroHint')}><Input id="heroTitleAr" name="heroTitleAr" dir="rtl" maxLength={90} defaultValue={s.hero.titleAr} /></Field>
            <Field label={t(l, 'th.heroTitleEn')} htmlFor="heroTitleEn"><Input id="heroTitleEn" name="heroTitleEn" dir="ltr" maxLength={90} defaultValue={s.hero.titleEn} /></Field>
            <Field label={t(l, 'th.heroSubAr')} htmlFor="heroSubtitleAr"><Input id="heroSubtitleAr" name="heroSubtitleAr" dir="rtl" maxLength={200} defaultValue={s.hero.subtitleAr} /></Field>
            <Field label={t(l, 'th.heroSubEn')} htmlFor="heroSubtitleEn"><Input id="heroSubtitleEn" name="heroSubtitleEn" dir="ltr" maxLength={200} defaultValue={s.hero.subtitleEn} /></Field>
            <Field label={t(l, 'th.announceAr')} htmlFor="announcementAr"><Input id="announcementAr" name="announcementAr" dir="rtl" maxLength={140} defaultValue={s.announcement.ar} /></Field>
            <Field label={t(l, 'th.announceEn')} htmlFor="announcementEn"><Input id="announcementEn" name="announcementEn" dir="ltr" maxLength={140} defaultValue={s.announcement.en} /></Field>
            <Field label={t(l, 'th.featured')} htmlFor="featuredCategoryId">
              <Select id="featuredCategoryId" name="featuredCategoryId" defaultValue={s.featuredCategoryId ?? ''}>
                <option value="">{t(l, 'th.featured.newest')}</option>
                {(cats?.ok ? cats.data : []).map((c) => <option key={c.id} value={c.id}>{displayName(l, c)}</option>)}
              </Select>
            </Field>
            <Field label={t(l, 'th.limit')} htmlFor="homeProductLimit">
              <Select id="homeProductLimit" name="homeProductLimit" defaultValue={String(s.homeProductLimit)}>
                {[4, 6, 8, 12, 16, 24].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-3">
            <SubmitButton>{t(l, 'th.save')}</SubmitButton>
            <button type="submit" name="intent" value="preview" className={buttonClass({ variant: 'ghost' })}>{t(l, 'th.savePreview')}</button>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
