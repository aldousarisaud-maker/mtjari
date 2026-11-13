import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@mtjari/shared';
import { Card, buttonClass } from '@/components/ui';
import { api } from '@/lib/api';
import { isLocale, t } from '@/lib/i18n';
import { can, getStore } from '../data';

interface Log { id: string; action: string; actorUserId: string | null; entityType: string | null; metadata: Record<string, unknown>; ip: string | null; createdAt: string }
interface Member { user: { id: string; name: string } }

export default async function AuditPage({ params, searchParams }: { params: Promise<{ locale: string; storeId: string }>; searchParams: Promise<{ cursor?: string }> }) {
  const { locale, storeId } = await params;
  const { cursor } = await searchParams;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  if (!can(store, PERMISSIONS.AUDIT_READ)) notFound();
  const qs = new URLSearchParams({ limit: '30' });
  if (typeof cursor === 'string' && /^[0-9a-f-]{36}$/i.test(cursor)) qs.set('cursor', cursor);
  const [logs, members] = await Promise.all([
    api<{ items: Log[]; nextCursor: string | null }>(`/v1/stores/${store.id}/audit-logs?${qs}`),
    can(store, PERMISSIONS.MEMBERS_READ) ? api<Member[]>(`/v1/stores/${store.id}/members`) : null,
  ]);
  const names = new Map((members?.ok ? members.data : []).map((m) => [m.user.id, m.user.name]));
  const fmt = new Intl.DateTimeFormat(l === 'ar' ? 'ar-KW' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const items = logs.ok ? logs.data.items : [];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t(l, 'side.audit')}</h1>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500">
            <tr>{(['audit.when', 'audit.action', 'audit.actor', 'audit.details'] as const).map((k) => <th key={k} className="px-5 py-3 text-start font-medium">{t(l, k)}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((log) => (
              <tr key={log.id} className="border-t border-slate-200/70 align-top">
                <td className="whitespace-nowrap px-5 py-3 text-slate-600">{fmt.format(new Date(log.createdAt))}</td>
                <td className="px-5 py-3 font-mono text-xs" dir="ltr">{log.action}</td>
                <td className="px-5 py-3">{(log.actorUserId && names.get(log.actorUserId)) || '—'}</td>
                <td className="max-w-xs px-5 py-3 font-mono text-[11px] text-slate-500" dir="ltr"><span className="line-clamp-2 break-all">{Object.keys(log.metadata).length ? JSON.stringify(log.metadata) : ''}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {logs.ok && logs.data.nextCursor ? (
        <Link href={`/${l}/dashboard/${store.id}/audit?cursor=${logs.data.nextCursor}`} className={buttonClass({ variant: 'ghost' })}>{t(l, 'audit.next')}</Link>
      ) : null}
    </div>
  );
}
