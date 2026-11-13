import { PERMISSIONS } from '@mtjari/shared';
import { updateStoreAction } from '@/app/actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Card } from '@/components/ui';
import { isLocale, roleLabel, statusLabel, t } from '@/lib/i18n';
import { StoreFields } from '../store-fields';
import { can, getStore } from './data';

export default async function StoreOverview({ params }: { params: Promise<{ locale: string; storeId: string }> }) {
  const { locale, storeId } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  const primary = store.domains.find((d) => d.isPrimary) ?? store.domains[0];
  const facts = [
    [t(l, 'store.status'), statusLabel(l, store.status)],
    [t(l, 'store.domain'), primary?.hostname ?? '—'],
    [t(l, 'store.role'), store.access.roleKey ? roleLabel(l, { key: store.access.roleKey, name: store.access.roleKey }) : '—'],
    [t(l, 'store.currency'), store.currency],
  ] as const;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{store.name}</h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {facts.map(([k, v]) => (
          <Card key={k} className="p-5">
            <p className="text-xs text-slate-500">{k}</p>
            <p className="mt-1.5 truncate font-semibold" dir="auto">{v}</p>
          </Card>
        ))}
      </div>
      {can(store, PERMISSIONS.STORE_UPDATE) ? (
        <Card className="max-w-2xl">
          <ActionForm action={updateStoreAction}>
            <input type="hidden" name="locale" value={l} />
            <input type="hidden" name="storeId" value={store.id} />
            <StoreFields locale={l} values={store} />
            <SubmitButton>{t(l, 'store.save')}</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
