import Link from 'next/link';
import { Plus, Store } from 'lucide-react';
import { Badge, Card, buttonClass } from '@/components/ui';
import { requireMe } from '@/lib/api';
import { isLocale, roleLabel, statusLabel, t } from '@/lib/i18n';

export default async function StoresPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const me = await requireMe(l);
  return (
    <section className="rise">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t(l, 'dash.stores')}</h1>
        <Link href={`/${l}/dashboard/new`} className={buttonClass()}><Plus className="size-4" aria-hidden />{t(l, 'dash.new')}</Link>
      </div>
      {me.stores.length === 0 ? (
        <Card className="py-14 text-center text-slate-500">
          <Store className="mx-auto mb-3 size-8 text-primary/60" aria-hidden />
          {t(l, 'dash.empty')}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {me.stores.map((s) => (
            <Link key={s.id} href={`/${l}/dashboard/${s.id}`} className="group">
              <Card className="transition-transform duration-300 group-hover:-translate-y-1">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-lg font-semibold">{s.name}</h2>
                  <Badge>{roleLabel(l, s.role)}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500" dir="ltr">{s.slug}.mtjari.cc</p>
                <p className="mt-4 text-xs text-slate-400">{statusLabel(l, s.status)}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
