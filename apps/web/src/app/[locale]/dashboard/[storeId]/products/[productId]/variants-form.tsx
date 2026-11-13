'use client';

import { replaceVariantsAction } from '@/app/catalog-actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { VariantEditor, type EditorLabels, type EditorVariant } from '../variant-editor';

export function VariantsForm(props: {
  locale: string; storeId: string; productId: string; currency: string; type: 'SIMPLE' | 'VARIANT' | 'DIGITAL';
  labels: EditorLabels; options: { name: string; values: string[] }[]; variants: EditorVariant[]; save: string;
}) {
  return (
    <ActionForm action={replaceVariantsAction}>
      <input type="hidden" name="locale" value={props.locale} />
      <input type="hidden" name="storeId" value={props.storeId} />
      <input type="hidden" name="productId" value={props.productId} />
      <VariantEditor type={props.type} currency={props.currency} labels={props.labels} initialOptions={props.options} initialVariants={props.variants} />
      <SubmitButton>{props.save}</SubmitButton>
    </ActionForm>
  );
}
