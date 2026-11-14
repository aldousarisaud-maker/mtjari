import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_THEME_ID, PERMISSIONS, isThemeId, type ThemeId, type ThemeSettings } from '@mtjari/shared';
import { launchStoreAction, previewThemeAction, publishThemeAction } from '@/app/theme-actions';
import { Badge, Card, buttonClass } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, t, type Key } from '@/lib/i18n';
import { ThemeBuilder } from './builder';
import { shopOrigin } from '@/storefront/api';
import { can, getStore } from '../data';
import { displayName, type CategoryOption } from '../products/product-fields';
import { RowAction } from '../row-action';

const LABEL_KEYS = [
  'tb.sections', 'tb.add', 'tb.type.hero', 'tb.type.products', 'tb.type.categories', 'tb.type.banner', 'tb.type.text', 'tb.up', 'tb.down', 'tb.remove', 'tb.drag',
  'tb.undo', 'tb.redo', 'tb.device.mobile', 'tb.device.tablet', 'tb.device.desktop', 'tb.preview', 'tb.refresh', 'tb.previewNote', 'tb.dirty', 'tb.saveDraft',
  'tb.publish', 'tb.history', 'tb.noVersions', 'tb.restore', 'tb.titleAr', 'tb.titleEn', 'tb.category', 'tb.limit', 'tb.textAr', 'tb.textEn', 'tb.bodyAr', 'tb.bodyEn',
  'tb.button', 'tb.maxSections', 'tb.colors', 'tb.heroAnn', 'tb.saving', 'tb.newest', 'tb.heroTexts', 'th.categoriesNote', 'th.primary', 'th.accent', 'th.heroTitleAr',
  'th.heroTitleEn', 'th.heroSubAr', 'th.heroSubEn', 'th.announceAr', 'th.announceEn',
] as const satisfies readonly Key[];

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

      <section aria-labelledby="builder">
        <h2 id="builder" className="mb-3 text-lg font-semibold">{t(l, 'th.settings')}: {selected.name[l]}</h2>
        {/* key: switching theme remounts the builder with that theme's stored values */}
        <ThemeBuilder
          key={selectedId} locale={l} storeId={store.id} themeId={selectedId} initial={s} canPublish
          categories={(cats?.ok ? cats.data : []).map((c) => ({ id: c.id, label: displayName(l, c) }))}
          labels={Object.fromEntries(LABEL_KEYS.map((k) => [k, t(l, k)]))}
        />
      </section>
    </div>
  );
}
