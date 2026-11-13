import Link from 'next/link';
import { ArrowRight, Boxes, FolderTree, Palette, KeyRound, LayoutDashboard, Package, ScrollText, Tags, Users } from 'lucide-react';
import { PERMISSIONS } from '@mtjari/shared';
import { Badge } from '@/components/ui';
import { isLocale, statusLabel, t } from '@/lib/i18n';
import { can, getStore } from './data';

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string; storeId: string }> }) {
  const { locale, storeId } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const store = await getStore(storeId);
  const base = `/${l}/dashboard/${store.id}`;
  // Only sections the member is allowed to open are listed.
  const items = [
    { href: base, label: t(l, 'side.overview'), icon: LayoutDashboard, show: true },
    { href: `${base}/products`, label: t(l, 'side.products'), icon: Package, show: can(store, PERMISSIONS.PRODUCTS_READ) },
    { href: `${base}/categories`, label: t(l, 'side.categories'), icon: FolderTree, show: can(store, PERMISSIONS.PRODUCTS_READ) },
    { href: `${base}/brands`, label: t(l, 'side.brands'), icon: Tags, show: can(store, PERMISSIONS.PRODUCTS_READ) },
    { href: `${base}/inventory`, label: t(l, 'side.inventory'), icon: Boxes, show: can(store, PERMISSIONS.INVENTORY_READ) },
    { href: `${base}/theme`, label: t(l, 'side.theme'), icon: Palette, show: can(store, PERMISSIONS.THEMES_MANAGE) },
    { href: `${base}/team`, label: t(l, 'side.team'), icon: Users, show: can(store, PERMISSIONS.MEMBERS_READ) },
    { href: `${base}/roles`, label: t(l, 'side.roles'), icon: KeyRound, show: can(store, PERMISSIONS.ROLES_READ) },
    { href: `${base}/audit`, label: t(l, 'side.audit'), icon: ScrollText, show: can(store, PERMISSIONS.AUDIT_READ) },
  ].filter((i) => i.show);
  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside className="glass h-fit min-w-0 p-3 lg:sticky lg:top-24">
        <div className="px-3 pb-3 pt-2">
          <p className="truncate font-semibold">{store.name}</p>
          <p className="truncate text-xs text-slate-500" dir="ltr">{(store.domains.find((d) => d.isPrimary) ?? store.domains[0])?.hostname ?? store.slug}</p>
          <Badge className="mt-2">{statusLabel(l, store.status)}</Badge>
        </div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {items.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-slate-700 transition hover:bg-primary/10 hover:text-primary dark:text-slate-200">
              <Icon className="size-4" aria-hidden />{label}
            </Link>
          ))}
          <Link href={`/${l}/dashboard`} className="flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-slate-500 hover:text-primary lg:mt-2 lg:border-t lg:border-slate-200/70">
            <ArrowRight className="size-4 ltr:rotate-180" aria-hidden />{t(l, 'side.all')}
          </Link>
        </nav>
      </aside>
      <div className="rise min-w-0">{children}</div>
    </div>
  );
}
