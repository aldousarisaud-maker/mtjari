import Link from 'next/link';
import { buttonClass } from '@/components/ui';
import { t, type Locale } from '@/lib/i18n';

export function Pager({ locale: l, base, page, total, limit, query = {} }: { locale: Locale; base: string; page: number; total: number; limit: number; query?: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v));
    qs.set('page', String(p));
    return `${base}?${qs}`;
  };
  return (
    <nav className="flex items-center gap-3 text-sm" aria-label="pagination">
      {page > 1 ? <Link href={href(page - 1)} className={buttonClass({ variant: 'ghost', size: 'sm' })}>{t(l, 'pg.prev')}</Link> : null}
      <span className="tabular-nums text-slate-500" dir="ltr">{page} / {pages}</span>
      {page < pages ? <Link href={href(page + 1)} className={buttonClass({ variant: 'ghost', size: 'sm' })}>{t(l, 'pg.next')}</Link> : null}
    </nav>
  );
}
