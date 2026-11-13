import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@mtjari/shared';
import { createRoleAction, deleteRoleAction } from '@/app/actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, roleLabel, t } from '@/lib/i18n';
import { can, getStore } from '../data';
import { RowAction } from '../row-action';

interface Role { id: string; key: string | null; name: string; permissions: string[]; isSystem: boolean; memberCount: number }

export default async function RolesPage({ params }: { params: Promise<{ locale: string; storeId: string }> }) {
  const { locale, storeId } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  if (!can(store, PERMISSIONS.ROLES_READ)) notFound();
  const roles = await api<Role[]>(`/v1/stores/${store.id}/roles`);
  const manage = can(store, PERMISSIONS.ROLES_MANAGE);
  // A member can only hand out permissions they hold themselves (enforced by the API too).
  const grantable = store.access.permissions;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t(l, 'side.roles')}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {(roles.ok ? roles.data : []).map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold">{roleLabel(l, r)}</h2>
              <div className="flex items-center gap-2">
                {r.isSystem ? <Badge className="bg-slate-100 text-slate-600">{t(l, 'roles.system')}</Badge> : null}
                <span className="text-xs text-slate-500">{r.memberCount} {t(l, 'roles.members')}</span>
              </div>
            </div>
            <ul dir="ltr" className="mt-3 flex flex-wrap gap-1.5">
              {r.permissions.map((p) => <li key={p} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{p}</li>)}
            </ul>
            {manage && !r.isSystem ? (
              <div className="mt-4"><RowAction action={deleteRoleAction} fields={{ locale: l, storeId: store.id, id: r.id }} label={t(l, 'roles.delete')} variant="danger" /></div>
            ) : null}
          </Card>
        ))}
      </div>

      {manage ? (
        <Card>
          <h2 className="mb-4 text-lg font-semibold">{t(l, 'roles.custom')}</h2>
          <ActionForm action={createRoleAction}>
            <input type="hidden" name="locale" value={l} />
            <input type="hidden" name="storeId" value={store.id} />
            <div className="max-w-sm"><Field label={t(l, 'roles.name')} htmlFor="name"><Input id="name" name="name" required minLength={2} maxLength={60} /></Field></div>
            <fieldset dir="ltr" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {grantable.map((p) => (
                <label key={p} className="flex items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-xs hover:bg-primary/5">
                  <input type="checkbox" name="permissions" value={p} className="size-4 accent-[#2563EB]" />{p}
                </label>
              ))}
            </fieldset>
            <SubmitButton>{t(l, 'roles.create')}</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
