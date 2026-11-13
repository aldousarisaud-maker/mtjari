import { notFound } from 'next/navigation';
import { PERMISSIONS, currencyDecimals, formatMoney, fromMinor } from '@mtjari/shared';
import { addKuwaitZonesAction, createZoneAction, deleteZoneAction, saveCheckoutSettingsAction, setPaymentMethodAction, updateZoneAction } from '@/app/order-actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, Field, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, t } from '@/lib/i18n';
import { can, getStore } from '../data';
import { RowAction } from '../row-action';

interface Zone { id: string; nameAr: string; nameEn: string; fee: number; freeAbove: number | null; isActive: boolean }
interface Settings { pickupEnabled: boolean; pickupInstructionsAr: string; pickupInstructionsEn: string; minOrderAmount: number }
interface Method { provider: string; kind: 'offline' | 'online'; name: { ar: string; en: string }; credentialFields: { key: string; label: { ar: string; en: string }; type: 'secret' | 'select'; options: { value: string; label: { ar: string; en: string } }[] | null; value: string | null }[]; configured: boolean; enabled: boolean; mode: 'test' | 'live' | null }

export default async function DeliveryPage({ params }: { params: Promise<{ locale: string; storeId: string }> }) {
  const { locale, storeId } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  const manageSettings = can(store, PERMISSIONS.SETTINGS_MANAGE);
  const managePayments = can(store, PERMISSIONS.PAYMENTS_MANAGE);
  if (!manageSettings && !managePayments) notFound();
  const [zonesRes, settingsRes, methodsRes] = await Promise.all([
    api<Zone[]>(`/v1/stores/${store.id}/delivery-zones`),
    api<Settings>(`/v1/stores/${store.id}/checkout-settings`),
    managePayments ? api<Method[]>(`/v1/stores/${store.id}/payment-methods`) : Promise.resolve(null),
  ]);
  const zones = zonesRes.ok ? zonesRes.data : [];
  const settings = settingsRes.ok ? settingsRes.data : { pickupEnabled: false, pickupInstructionsAr: '', pickupInstructionsEn: '', minOrderAmount: 0 };
  const methods = methodsRes?.ok ? methodsRes.data : [];
  const cur = store.currency;
  const amount = (v: number | null) => (v == null ? '' : fromMinor(v, cur));
  const step = (1 / 10 ** currencyDecimals(cur)).toFixed(currencyDecimals(cur));
  const hidden = { locale: l, storeId: store.id };
  const Hidden = () => <>{Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;
  const money = { inputMode: 'decimal' as const, dir: 'ltr' as const, placeholder: step };
  const hasDelivery = zones.some((z) => z.isActive) || settings.pickupEnabled;
  const hasPayment = methods.some((m) => m.enabled);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t(l, 'd.title')}</h1>

      {managePayments ? (
        <Card data-testid="checkout-readiness">
          <h2 className="text-lg font-semibold">{t(l, 'd.readiness')}</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {hasDelivery && hasPayment ? <li className="text-emerald-700">{t(l, 'd.ready')}</li> : null}
            {!hasPayment ? <li className="text-amber-700">{t(l, 'd.needPayment')}</li> : null}
            {!hasDelivery ? <li className="text-amber-700">{t(l, 'd.needDelivery')}</li> : null}
          </ul>
        </Card>
      ) : null}

      {managePayments ? (
        <Card>
          <h2 className="text-lg font-semibold">{t(l, 'd.payments')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t(l, 'd.paymentsHint')}</p>
          <ul className="mt-4 space-y-4">
            {methods.map((m) => (
              <li key={m.provider} className="rounded-xl border border-slate-200/70 p-4" data-testid={`method-${m.provider}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-semibold">{m.name[l]}</p>
                  {m.enabled
                    ? <Badge className="bg-emerald-100 text-emerald-800">{t(l, 'd.enabled')}</Badge>
                    : m.configured ? <Badge className="bg-slate-200 text-slate-700">{t(l, 'd.disabled')}</Badge> : <Badge className="bg-amber-100 text-amber-800">{t(l, 'd.pending')}</Badge>}
                  {m.mode ? <Badge className={m.mode === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'} data-testid={`mode-${m.provider}`}>{t(l, `d.mode.${m.mode}`)}</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-slate-500">{t(l, `d.kind.${m.kind}`)}</p>
                {m.mode ? <p className="mt-1 text-xs text-slate-500">{t(l, m.provider === 'myfatoorah' ? `d.modeHint.myfatoorah.${m.mode}` : `d.modeHint.${m.mode}`)}</p> : null}
                {(m.provider === 'tap' || m.provider === 'myfatoorah') && !m.enabled ? <p className="mt-2 text-sm text-slate-600">{t(l, `d.help.${m.provider}`)}</p> : null}
                <ActionForm action={setPaymentMethodAction} className="mt-3 space-y-3">
                  <Hidden /><input type="hidden" name="provider" value={m.provider} /><input type="hidden" name="enabled" value={m.enabled ? 'false' : 'true'} />
                  {/* Secrets are write-only: the stored value is never sent to the browser. */}
                  {!m.enabled ? m.credentialFields.map((f) => f.type === 'select' ? (
                    <Field key={f.key} label={f.label[l]} htmlFor={`cred-${m.provider}-${f.key}`}>
                      <Select id={`cred-${m.provider}-${f.key}`} name={`cred.${f.key}`} defaultValue={f.value ?? ''} required>
                        <option value="" disabled>{t(l, 'd.choose')}</option>
                        {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label[l]}</option>)}
                      </Select>
                    </Field>
                  ) : (
                    <Field key={f.key} label={f.label[l]} htmlFor={`cred-${m.provider}-${f.key}`} hint={m.configured ? t(l, 'd.credsSaved') : undefined}>
                      <Input id={`cred-${m.provider}-${f.key}`} name={`cred.${f.key}`} type="password" autoComplete="off" dir="ltr" required={!m.configured} maxLength={2000} />
                    </Field>
                  )) : null}
                  <SubmitButton size="sm" variant={m.enabled ? 'ghost' : 'primary'}>{t(l, m.enabled ? 'd.disable' : 'd.enable')}</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-lg font-semibold">{t(l, 'd.zones')}</h2>
        {zones.length ? (
          <ul className="mt-4 space-y-3">
            {zones.map((z) => (
              <li key={z.id} className="rounded-xl border border-slate-200/70 p-4" data-testid="zone-row">
                {manageSettings ? (
                  <>
                    <ActionForm action={updateZoneAction} className="grid items-end gap-3 space-y-0 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_8rem_10rem_auto_auto]">
                      <Hidden /><input type="hidden" name="zoneId" value={z.id} />
                      <Field label={t(l, 'd.nameAr')} htmlFor={`zar-${z.id}`}><Input id={`zar-${z.id}`} name="nameAr" defaultValue={z.nameAr} required maxLength={80} dir="rtl" /></Field>
                      <Field label={t(l, 'd.nameEn')} htmlFor={`zen-${z.id}`}><Input id={`zen-${z.id}`} name="nameEn" defaultValue={z.nameEn} required maxLength={80} dir="ltr" /></Field>
                      <Field label={`${t(l, 'd.fee')} (${cur})`} htmlFor={`zfee-${z.id}`}><Input id={`zfee-${z.id}`} name="fee" defaultValue={amount(z.fee)} required {...money} /></Field>
                      <Field label={t(l, 'd.freeAbove')} htmlFor={`zfree-${z.id}`}><Input id={`zfree-${z.id}`} name="freeAbove" defaultValue={amount(z.freeAbove)} {...money} /></Field>
                      <label className="flex h-11 items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={z.isActive} className="size-4 accent-[#2563EB]" />{t(l, 'd.active')}</label>
                      <SubmitButton variant="ghost">{t(l, 'd.saveZone')}</SubmitButton>
                    </ActionForm>
                    <div className="mt-2"><RowAction action={deleteZoneAction} fields={{ ...hidden, zoneId: z.id }} label={t(l, 'd.deleteZone')} variant="danger" /></div>
                  </>
                ) : (
                  <p className="text-sm"><span dir="auto">{l === 'ar' ? z.nameAr : z.nameEn}</span> · {formatMoney(z.fee, cur, l)}</p>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-slate-500">{t(l, 'd.zonesEmpty')}</p>}

        {manageSettings ? (
          <div className="mt-6 grid gap-6 border-t border-slate-200/70 pt-6 lg:grid-cols-2">
            <ActionForm action={createZoneAction}>
              <h3 className="font-semibold">{t(l, 'd.newZone')}</h3>
              <Hidden /><input type="hidden" name="isActive" value="on" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t(l, 'd.nameAr')} htmlFor="new-zone-ar"><Input id="new-zone-ar" name="nameAr" required maxLength={80} dir="rtl" /></Field>
                <Field label={t(l, 'd.nameEn')} htmlFor="new-zone-en"><Input id="new-zone-en" name="nameEn" required maxLength={80} dir="ltr" /></Field>
                <Field label={`${t(l, 'd.fee')} (${cur})`} htmlFor="new-zone-fee"><Input id="new-zone-fee" name="fee" required {...money} /></Field>
                <Field label={t(l, 'd.freeAbove')} htmlFor="new-zone-free"><Input id="new-zone-free" name="freeAbove" {...money} /></Field>
              </div>
              <SubmitButton>{t(l, 'd.addZone')}</SubmitButton>
            </ActionForm>
            {store.country === 'KW' ? (
              <ActionForm action={addKuwaitZonesAction}>
                <h3 className="font-semibold">{t(l, 'd.kuwait')}</h3>
                <Hidden />
                <Field label={`${t(l, 'd.kuwaitFee')} (${cur})`} htmlFor="kuwait-fee"><Input id="kuwait-fee" name="fee" required {...money} /></Field>
                <SubmitButton variant="ghost">{t(l, 'd.kuwait')}</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        ) : null}
      </Card>

      {manageSettings ? (
        <Card>
          <h2 className="mb-4 text-lg font-semibold">{t(l, 'd.options')}</h2>
          <ActionForm action={saveCheckoutSettingsAction}>
            <Hidden />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pickupEnabled" defaultChecked={settings.pickupEnabled} className="size-4 accent-[#2563EB]" />{t(l, 'd.pickup')}</label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t(l, 'd.pickupAr')} htmlFor="pickup-ar"><Input id="pickup-ar" name="pickupInstructionsAr" defaultValue={settings.pickupInstructionsAr} maxLength={500} dir="rtl" /></Field>
              <Field label={t(l, 'd.pickupEn')} htmlFor="pickup-en"><Input id="pickup-en" name="pickupInstructionsEn" defaultValue={settings.pickupInstructionsEn} maxLength={500} dir="ltr" /></Field>
              <Field label={`${t(l, 'd.minOrder')} (${cur})`} htmlFor="min-order"><Input id="min-order" name="minOrderAmount" defaultValue={settings.minOrderAmount ? amount(settings.minOrderAmount) : ''} {...money} /></Field>
            </div>
            <SubmitButton>{t(l, 'd.saveOptions')}</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
