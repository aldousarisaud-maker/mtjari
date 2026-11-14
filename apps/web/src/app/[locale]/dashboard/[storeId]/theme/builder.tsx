'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { MAX_SECTIONS, SECTION_TYPES, type Section, type SectionType, type ThemeSettings } from '@mtjari/shared';
import { listVersions, previewUrl, publishDraft, restoreVersion, saveDraft, type VersionRow } from '@/app/theme-builder-actions';
import { Badge, Card, Field, Input, Select, buttonClass } from '@/components/ui';

export interface BuilderProps {
  locale: 'ar' | 'en';
  storeId: string;
  themeId: string;
  initial: ThemeSettings;
  categories: { id: string; label: string }[];
  /** Every visible text, resolved on the server in the member's language. */
  labels: Record<string, string>;
  canPublish: boolean;
}

const DEVICES = { mobile: 390, tablet: 768, desktop: 1180 } as const;
type Device = keyof typeof DEVICES;

const newId = () => `s${Math.random().toString(36).slice(2, 8)}`;
const blank = (type: SectionType): Section => {
  const id = newId();
  switch (type) {
    case 'hero': return { id, type };
    case 'categories': return { id, type };
    case 'products': return { id, type, titleAr: '', titleEn: '', categoryId: null, limit: 8 };
    case 'banner': return { id, type, textAr: '', textEn: '', button: true };
    case 'text': return { id, type, titleAr: '', titleEn: '', bodyAr: '', bodyEn: '' };
  }
};

/** Undo/redo over whole-settings snapshots. Typing in one field is one undo step, not one per keystroke. */
function useHistory(initial: ThemeSettings) {
  const [h, setH] = useState({ past: [] as ThemeSettings[], present: initial, future: [] as ThemeSettings[], key: '' });
  const set = useCallback((next: ThemeSettings, key = '') => setH((s) => (
    key && key === s.key ? { ...s, present: next, future: [] } : { past: [...s.past, s.present].slice(-100), present: next, future: [], key }
  )), []);
  const undo = useCallback(() => setH((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1]!, future: [s.present, ...s.future], key: '' } : s)), []);
  const redo = useCallback(() => setH((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0]!, future: s.future.slice(1), key: '' } : s)), []);
  const reset = useCallback((to: ThemeSettings) => setH({ past: [], present: to, future: [], key: '' }), []);
  return { value: h.present, set, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

export function ThemeBuilder({ locale, storeId, themeId, initial, categories, labels, canPublish }: BuilderProps) {
  const L = (k: string) => labels[k] ?? k;
  const hist = useHistory(initial);
  const s = hist.value;
  const saved = useRef(JSON.stringify(initial));
  const dirty = JSON.stringify(s) !== saved.current;
  const [device, setDevice] = useState<Device>('mobile');
  const [frame, setFrame] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [pending, start] = useTransition();
  const dragFrom = useRef<number | null>(null);

  const refreshPreview = useCallback(async () => {
    const r = await previewUrl(locale, storeId, themeId);
    if (r.previewUrl) setFrame(r.previewUrl);
  }, [locale, storeId, themeId]);
  const refreshVersions = useCallback(async () => setVersions((await listVersions(locale, storeId, themeId)).versions), [locale, storeId, themeId]);
  useEffect(() => { void refreshPreview(); void refreshVersions(); }, [refreshPreview, refreshVersions]);

  // Closing the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const setSections = (sections: Section[], key?: string) => hist.set({ ...s, sections }, key);
  const patch = (i: number, p: Partial<Section>, key: string) => setSections(s.sections.map((x, j) => (j === i ? ({ ...x, ...p } as Section) : x)), key);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= s.sections.length || from === to) return;
    const next = [...s.sections];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    setSections(next);
  };
  const has = (t: SectionType) => s.sections.some((x) => x.type === t);
  const addable = SECTION_TYPES.filter((t) => !((t === 'hero' || t === 'categories') && has(t)));
  const [adding, setAdding] = useState<SectionType>('products');
  const addType = addable.includes(adding) ? adding : addable[0];

  const save = (then?: () => Promise<void>) => start(async () => {
    setMsg({});
    const r = await saveDraft(locale, storeId, themeId, s);
    if (r.error) return setMsg({ error: r.error });
    saved.current = JSON.stringify(s);
    if (then) await then();
    else setMsg({ ok: r.ok });
    await refreshPreview();
    await refreshVersions();
  });
  const publish = () => save(async () => {
    const r = await publishDraft(locale, storeId, themeId);
    setMsg(r.error ? { error: r.error } : { ok: r.ok });
  });
  const restore = (id: string) => start(async () => {
    const r = await restoreVersion(locale, storeId, themeId, id);
    if (r.error) return setMsg({ error: r.error });
    if (r.settings) { hist.reset(r.settings); saved.current = JSON.stringify(r.settings); }
    setMsg({ ok: r.ok });
    await refreshPreview();
  });

  const text = (id: string, label: string, value: string, onChange: (v: string) => void, dir: 'rtl' | 'ltr', max: number, area = false) => (
    <Field label={label} htmlFor={id}>
      {area
        ? <textarea id={id} value={value} maxLength={max} dir={dir} rows={3} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        : <Input id={id} value={value} maxLength={max} dir={dir} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="builder-root">
      <div className="space-y-5">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="me-auto text-lg font-semibold">{L('tb.sections')}</h2>
            {dirty ? <Badge className="bg-amber-100 text-amber-700" data-testid="dirty">{L('tb.dirty')}</Badge> : null}
            <button type="button" onClick={hist.undo} disabled={!hist.canUndo} className={buttonClass({ variant: 'ghost', size: 'sm' })} data-testid="undo">{L('tb.undo')}</button>
            <button type="button" onClick={hist.redo} disabled={!hist.canRedo} className={buttonClass({ variant: 'ghost', size: 'sm' })} data-testid="redo">{L('tb.redo')}</button>
          </div>

          <ol className="space-y-2" data-testid="section-list">
            {s.sections.map((sec, i) => (
              <li
                key={sec.id} data-testid={`section-${i}`} data-type={sec.type}
                draggable onDragStart={() => { dragFrom.current = i; }} onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null; }}
                className="rounded-xl border border-slate-200 bg-white"
              >
                <details>
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
                    <span aria-hidden title={L('tb.drag')} data-testid={`handle-${i}`} className="cursor-grab select-none px-1 text-slate-400">⋮⋮</span>
                    <span className="me-auto font-medium">{L(`tb.type.${sec.type}`)}</span>
                    <button type="button" aria-label={L('tb.up')} disabled={i === 0} onClick={(e) => { e.preventDefault(); move(i, i - 1); }} className={buttonClass({ variant: 'ghost', size: 'sm' })} data-testid={`up-${i}`}>↑</button>
                    <button type="button" aria-label={L('tb.down')} disabled={i === s.sections.length - 1} onClick={(e) => { e.preventDefault(); move(i, i + 1); }} className={buttonClass({ variant: 'ghost', size: 'sm' })} data-testid={`down-${i}`}>↓</button>
                    <button type="button" aria-label={L('tb.remove')} disabled={s.sections.length <= 1} onClick={(e) => { e.preventDefault(); setSections(s.sections.filter((_, j) => j !== i)); }} className={buttonClass({ variant: 'danger', size: 'sm' })} data-testid={`remove-${i}`}>✕</button>
                  </summary>
                  <div className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2">
                    {sec.type === 'products' ? (
                      <>
                        {text(`${sec.id}-ta`, L('tb.titleAr'), sec.titleAr, (v) => patch(i, { titleAr: v }, `${sec.id}-ta`), 'rtl', 60)}
                        {text(`${sec.id}-te`, L('tb.titleEn'), sec.titleEn, (v) => patch(i, { titleEn: v }, `${sec.id}-te`), 'ltr', 60)}
                        <Field label={L('tb.category')} htmlFor={`${sec.id}-cat`}>
                          <Select id={`${sec.id}-cat`} value={sec.categoryId ?? ''} onChange={(e) => patch(i, { categoryId: e.target.value || null }, '')}>
                            <option value="">{L('tb.newest')}</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                          </Select>
                        </Field>
                        <Field label={L('tb.limit')} htmlFor={`${sec.id}-lim`}>
                          <Select id={`${sec.id}-lim`} value={String(sec.limit)} onChange={(e) => patch(i, { limit: Number(e.target.value) }, '')}>
                            {[4, 6, 8, 12, 16, 24].map((n) => <option key={n} value={n}>{n}</option>)}
                          </Select>
                        </Field>
                      </>
                    ) : null}
                    {sec.type === 'banner' ? (
                      <>
                        {text(`${sec.id}-xa`, L('tb.textAr'), sec.textAr, (v) => patch(i, { textAr: v }, `${sec.id}-xa`), 'rtl', 160)}
                        {text(`${sec.id}-xe`, L('tb.textEn'), sec.textEn, (v) => patch(i, { textEn: v }, `${sec.id}-xe`), 'ltr', 160)}
                        <label className="flex items-center gap-2 text-sm sm:col-span-2">
                          <input type="checkbox" checked={sec.button} onChange={(e) => patch(i, { button: e.target.checked }, '')} /> {L('tb.button')}
                        </label>
                      </>
                    ) : null}
                    {sec.type === 'text' ? (
                      <>
                        {text(`${sec.id}-ta`, L('tb.titleAr'), sec.titleAr, (v) => patch(i, { titleAr: v }, `${sec.id}-ta`), 'rtl', 80)}
                        {text(`${sec.id}-te`, L('tb.titleEn'), sec.titleEn, (v) => patch(i, { titleEn: v }, `${sec.id}-te`), 'ltr', 80)}
                        {text(`${sec.id}-ba`, L('tb.bodyAr'), sec.bodyAr, (v) => patch(i, { bodyAr: v }, `${sec.id}-ba`), 'rtl', 1000, true)}
                        {text(`${sec.id}-be`, L('tb.bodyEn'), sec.bodyEn, (v) => patch(i, { bodyEn: v }, `${sec.id}-be`), 'ltr', 1000, true)}
                      </>
                    ) : null}
                    {sec.type === 'hero' ? <p className="text-sm text-slate-500 sm:col-span-2">{L('tb.heroTexts')}</p> : null}
                    {sec.type === 'categories' ? <p className="text-sm text-slate-500 sm:col-span-2">{L('th.categoriesNote')}</p> : null}
                  </div>
                </details>
              </li>
            ))}
          </ol>

          {s.sections.length < MAX_SECTIONS && addType ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label={L('tb.add')} value={addType} onChange={(e) => setAdding(e.target.value as SectionType)} className="w-auto" data-testid="add-type">
                {addable.map((t) => <option key={t} value={t}>{L(`tb.type.${t}`)}</option>)}
              </Select>
              <button type="button" onClick={() => setSections([...s.sections, blank(addType)])} className={buttonClass({ variant: 'ghost' })} data-testid="add-section">{L('tb.add')}</button>
            </div>
          ) : <p className="text-sm text-slate-500">{L('tb.maxSections')}</p>}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">{L('tb.colors')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={L('th.primary')} htmlFor="tb-primary"><Input id="tb-primary" type="color" value={s.colors.primary} onChange={(e) => hist.set({ ...s, colors: { ...s.colors, primary: e.target.value } }, 'c-p')} className="p-1" /></Field>
            <Field label={L('th.accent')} htmlFor="tb-accent"><Input id="tb-accent" type="color" value={s.colors.accent} onChange={(e) => hist.set({ ...s, colors: { ...s.colors, accent: e.target.value } }, 'c-a')} className="p-1" /></Field>
          </div>
          <h2 className="pt-2 text-lg font-semibold">{L('tb.heroAnn')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {text('tb-hta', L('th.heroTitleAr'), s.hero.titleAr, (v) => hist.set({ ...s, hero: { ...s.hero, titleAr: v } }, 'h-ta'), 'rtl', 90)}
            {text('tb-hte', L('th.heroTitleEn'), s.hero.titleEn, (v) => hist.set({ ...s, hero: { ...s.hero, titleEn: v } }, 'h-te'), 'ltr', 90)}
            {text('tb-hsa', L('th.heroSubAr'), s.hero.subtitleAr, (v) => hist.set({ ...s, hero: { ...s.hero, subtitleAr: v } }, 'h-sa'), 'rtl', 200)}
            {text('tb-hse', L('th.heroSubEn'), s.hero.subtitleEn, (v) => hist.set({ ...s, hero: { ...s.hero, subtitleEn: v } }, 'h-se'), 'ltr', 200)}
            {text('tb-ana', L('th.announceAr'), s.announcement.ar, (v) => hist.set({ ...s, announcement: { ...s.announcement, ar: v } }, 'a-ar'), 'rtl', 140)}
            {text('tb-ane', L('th.announceEn'), s.announcement.en, (v) => hist.set({ ...s, announcement: { ...s.announcement, en: v } }, 'a-en'), 'ltr', 140)}
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => save()} disabled={pending} className={buttonClass()} data-testid="save-draft">{pending ? L('tb.saving') : L('tb.saveDraft')}</button>
            {canPublish ? <button type="button" onClick={publish} disabled={pending} className={buttonClass({ variant: 'ghost' })} data-testid="publish">{L('tb.publish')}</button> : null}
          </div>
          <div role="status" aria-live="polite" data-testid="builder-status">
            {msg.ok ? <p className="text-sm text-emerald-700">{msg.ok}</p> : null}
            {msg.error ? <p role="alert" className="text-sm text-red-600">{msg.error}</p> : null}
          </div>
        </Card>

        <Card className="space-y-3" data-testid="version-history">
          <h2 className="text-lg font-semibold">{L('tb.history')}</h2>
          {versions.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="me-auto">{new Date(v.createdAt).toLocaleString(locale === 'ar' ? 'ar-KW' : 'en-GB')}</span>
                  <span aria-hidden className="size-4 rounded-full border border-slate-200" style={{ background: v.colors.primary }} />
                  <span className="text-xs text-slate-500">{v.sections.map((x) => L(`tb.type.${x}`)).join(' · ')}</span>
                  <button type="button" disabled={pending} onClick={() => restore(v.id)} className={buttonClass({ variant: 'ghost', size: 'sm' })} data-testid="restore-version">{L('tb.restore')}</button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">{L('tb.noVersions')}</p>}
        </Card>
      </div>

      <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="me-auto text-lg font-semibold">{L('tb.preview')}</h2>
            {(Object.keys(DEVICES) as Device[]).map((d) => (
              <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} data-testid={`device-${d}`}
                className={buttonClass({ variant: device === d ? 'primary' : 'ghost', size: 'sm' })}>{L(`tb.device.${d}`)}</button>
            ))}
            <button type="button" onClick={() => void refreshPreview()} className={buttonClass({ variant: 'ghost', size: 'sm' })}>{L('tb.refresh')}</button>
          </div>
          <p className="text-xs text-slate-500">{L('tb.previewNote')}</p>
          {/* Scrolls inside this box; the frame ignores the pointer so a click can't navigate away from the preview. */}
          <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-slate-100">
            <div className="mx-auto" style={{ width: Math.min(DEVICES[device], 4000), maxWidth: '100%' }}>
              {frame ? <iframe key={frame} src={frame} title={L('tb.preview')} data-testid="preview-frame" className="pointer-events-none block h-[2600px] w-full bg-white" /> : null}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
