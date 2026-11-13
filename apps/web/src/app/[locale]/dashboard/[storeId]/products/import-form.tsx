'use client';

import { importCsvAction } from '@/app/catalog-actions';
import { ActionForm, SubmitButton } from '@/components/action-form';

export function ImportForm({ locale, storeId, cta, rowLabel }: { locale: string; storeId: string; cta: string; rowLabel: string }) {
  return (
    <ActionForm
      action={importCsvAction}
      render={(state) => {
        const errors = (state.data?.errors ?? []) as { row: number; message: string }[];
        return errors.length ? (
          <ul className="max-h-48 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900" data-testid="import-errors">
            {errors.map((e, i) => <li key={i}>{rowLabel} {e.row}: <span dir="ltr">{e.message}</span></li>)}
          </ul>
        ) : null;
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="storeId" value={storeId} />
      <input name="file" type="file" required accept=".csv,text/csv" aria-label="CSV" className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-primary" />
      <SubmitButton variant="ghost">{cta}</SubmitButton>
    </ActionForm>
  );
}
