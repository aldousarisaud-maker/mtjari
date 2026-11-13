'use client';

import { useState, type ReactNode } from 'react';
import { PRODUCT_TYPES } from '@mtjari/shared';
import { createProductAction } from '@/app/catalog-actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Field, Select } from '@/components/ui';
import { VariantEditor, type EditorLabels } from '../variant-editor';

type ProductType = (typeof PRODUCT_TYPES)[number];

export function NewProductForm({
  locale, storeId, currency, children, labels, typeLabels, text,
}: {
  locale: string; storeId: string; currency: string; children: ReactNode;
  labels: EditorLabels; typeLabels: Record<ProductType, string>; text: { type: string; pricing: string; create: string };
}) {
  const [type, setType] = useState<ProductType>('SIMPLE');
  return (
    <ActionForm action={createProductAction} className="space-y-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="storeId" value={storeId} />
      {children}
      <div className="max-w-sm">
        <Field label={text.type} htmlFor="type">
          <Select id="type" name="type" value={type} onChange={(e) => setType(e.target.value as ProductType)}>
            {PRODUCT_TYPES.map((p) => <option key={p} value={p}>{typeLabels[p]}</option>)}
          </Select>
        </Field>
      </div>
      <h2 className="pt-2 text-lg font-semibold">{text.pricing} <span className="text-sm font-normal text-slate-500" dir="ltr">({currency})</span></h2>
      {/* key: switching type resets rows so stale option values are never submitted */}
      <VariantEditor key={type} type={type} currency={currency} labels={labels} />
      <SubmitButton>{text.create}</SubmitButton>
    </ActionForm>
  );
}
