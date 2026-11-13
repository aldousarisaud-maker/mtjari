'use client';

import { useEffect, useState } from 'react';
import { checkSlugAction } from '@/app/actions';
import { Input, Label } from '@/components/ui';

type Labels = { label: string; ok: string; taken: string; reserved: string; format: string };

export function SlugField({ labels }: { labels: Labels }) {
  const [slug, setSlug] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'reserved' | 'format'>('idle');

  useEffect(() => {
    if (!slug) return setStatus('idle');
    setStatus('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await checkSlugAction(slug);
      if (cancelled || !res) return;
      setStatus(res.available ? 'ok' : ((res.reason as 'taken' | 'reserved' | 'format') ?? 'format'));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug]);

  const message = status === 'ok' ? labels.ok : status === 'idle' || status === 'checking' ? labels.format : labels[status];
  return (
    <div>
      <Label htmlFor="slug">{labels.label}</Label>
      <div dir="ltr" className="flex items-center rounded-xl border border-slate-200 bg-white/80 shadow-sm focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15">
        <Input
          id="slug" name="slug" required minLength={3} maxLength={40} autoComplete="off" spellCheck={false}
          value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          className="border-0 bg-transparent shadow-none focus:ring-0" aria-describedby="slug-status"
        />
        <span className="shrink-0 pe-3.5 text-sm text-slate-500">.mtjari.cc</span>
      </div>
      <p id="slug-status" aria-live="polite" className={`mt-1.5 text-xs ${status === 'ok' ? 'text-emerald-600' : status === 'idle' || status === 'checking' ? 'text-slate-500' : 'text-red-600'}`}>
        {message}
      </p>
    </div>
  );
}
