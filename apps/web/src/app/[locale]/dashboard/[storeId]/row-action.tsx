'use client';

import type { ReactNode } from 'react';
import { ActionForm, SubmitButton, type FormAction } from '@/components/action-form';

/** Small inline form for table-row actions (revoke, remove, change role...). */
export function RowAction({
  action, fields, label, variant = 'ghost', children,
}: {
  action: FormAction;
  fields: Record<string, string>;
  label: string;
  variant?: 'ghost' | 'danger';
  children?: ReactNode;
}) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-center gap-2 space-y-0">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <SubmitButton size="sm" variant={variant}>{label}</SubmitButton>
    </ActionForm>
  );
}
