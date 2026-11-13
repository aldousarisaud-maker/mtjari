import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@mtjari/shared';
import { changeRoleAction, inviteAction, removeMemberAction, revokeInvitationAction } from '@/app/actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, Field, Input, Select } from '@/components/ui';
import { api, requireMe } from '@/lib/api';
import { isLocale, roleLabel, t } from '@/lib/i18n';
import { can, getStore } from '../data';
import { RowAction } from '../row-action';

interface Member { id: string; status: string; role: { id: string; key: string | null; name: string }; user: { id: string; name: string; email: string; mfaEnabled: boolean } }
interface Role { id: string; key: string | null; name: string }
interface Invitation { id: string; email: string; expiresAt: string; role: Role }

export default async function TeamPage({ params }: { params: Promise<{ locale: string; storeId: string }> }) {
  const { locale, storeId } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const [store, me] = await Promise.all([getStore(storeId), requireMe(l)]);
  if (!can(store, PERMISSIONS.MEMBERS_READ)) notFound();
  const [members, roles, invitations] = await Promise.all([
    api<Member[]>(`/v1/stores/${store.id}/members`),
    api<Role[]>(`/v1/stores/${store.id}/roles`),
    api<Invitation[]>(`/v1/stores/${store.id}/invitations`),
  ]);
  const roleList = roles.ok ? roles.data : [];
  const common = { locale: l, storeId: store.id };
  const fmt = new Intl.DateTimeFormat(l === 'ar' ? 'ar-KW' : 'en-GB', { dateStyle: 'medium' });

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t(l, 'side.team')}</h1>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-start text-xs text-slate-500">
            <tr><th className="px-5 py-3 text-start font-medium">{t(l, 'team.member')}</th><th className="px-5 py-3 text-start font-medium">{t(l, 'team.role')}</th><th className="px-5 py-3 text-start font-medium">{t(l, 'team.mfa')}</th><th /></tr>
          </thead>
          <tbody>
            {(members.ok ? members.data : []).map((m) => (
              <tr key={m.id} className="border-t border-slate-200/70">
                <td className="px-5 py-3"><p className="font-medium">{m.user.name}</p><p className="text-xs text-slate-500" dir="ltr">{m.user.email}</p></td>
                <td className="px-5 py-3"><Badge>{roleLabel(l, m.role)}</Badge></td>
                <td className="px-5 py-3 text-slate-600">{t(l, m.user.mfaEnabled ? 'common.yes' : 'common.no')}</td>
                <td className="px-5 py-3">
                  {m.user.id !== me.user.id ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      {can(store, PERMISSIONS.MEMBERS_UPDATE) ? (
                        <RowAction action={changeRoleAction} fields={{ ...common, id: m.id }} label={t(l, 'team.change')}>
                          <Select name="roleId" defaultValue={m.role.id} className="h-8 w-36 px-2 text-xs" aria-label={t(l, 'team.role')}>
                            {roleList.map((r) => <option key={r.id} value={r.id}>{roleLabel(l, r)}</option>)}
                          </Select>
                        </RowAction>
                      ) : null}
                      {can(store, PERMISSIONS.MEMBERS_REMOVE) ? <RowAction action={removeMemberAction} fields={{ ...common, id: m.id }} label={t(l, 'team.remove')} variant="danger" /> : null}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {can(store, PERMISSIONS.MEMBERS_INVITE) ? (
        <Card className="max-w-2xl">
          <h2 className="mb-4 text-lg font-semibold">{t(l, 'team.invite')}</h2>
          <ActionForm action={inviteAction}>
            <input type="hidden" name="locale" value={l} />
            <input type="hidden" name="storeId" value={store.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t(l, 'auth.email')} htmlFor="email"><Input id="email" name="email" type="email" required dir="ltr" /></Field>
              <Field label={t(l, 'team.role')} htmlFor="roleId">
                <Select id="roleId" name="roleId" defaultValue={roleList.find((r) => r.key === 'staff')?.id}>
                  {roleList.map((r) => <option key={r.id} value={r.id}>{roleLabel(l, r)}</option>)}
                </Select>
              </Field>
            </div>
            <SubmitButton>{t(l, 'team.invite.cta')}</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}

      {invitations.ok && invitations.data.length > 0 ? (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">{t(l, 'team.pending')}</h2>
          <ul className="divide-y divide-slate-200/70">
            {invitations.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span><span dir="ltr">{i.email}</span> <Badge className="ms-2">{roleLabel(l, i.role)}</Badge> <span className="ms-2 text-xs text-slate-500">{fmt.format(new Date(i.expiresAt))}</span></span>
                {can(store, PERMISSIONS.MEMBERS_INVITE) ? <RowAction action={revokeInvitationAction} fields={{ ...common, id: i.id }} label={t(l, 'team.revoke')} variant="danger" /> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
