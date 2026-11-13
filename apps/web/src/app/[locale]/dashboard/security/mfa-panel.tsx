'use client';

import { useActionState } from 'react';
import { mfaDisableAction, mfaEnableAction, mfaSetupAction } from '@/app/actions';
import { ActionForm, SubmitButton, type ActionState } from '@/components/action-form';
import { Field, Input } from '@/components/ui';

type L = Record<'start' | 'key' | 'enable' | 'disable' | 'codes' | 'code' | 'password', string>;

export function MfaPanel({ locale, enabled, labels }: { locale: string; enabled: boolean; labels: L }) {
  const [setup, startSetup] = useActionState<ActionState, FormData>(mfaSetupAction, {});
  const secret = setup.data?.secret as string | undefined;

  if (enabled) {
    return (
      <ActionForm action={mfaDisableAction} className="max-w-sm">
        <input type="hidden" name="locale" value={locale} />
        <Field label={labels.password} htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" /></Field>
        <Field label={labels.code} htmlFor="code"><Input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required dir="ltr" autoComplete="one-time-code" /></Field>
        <SubmitButton variant="danger">{labels.disable}</SubmitButton>
      </ActionForm>
    );
  }

  if (!secret) {
    return (
      <form action={startSetup}>
        <input type="hidden" name="locale" value={locale} />
        <SubmitButton>{labels.start}</SubmitButton>
        {setup.error ? <p role="alert" className="mt-3 text-sm text-red-600">{setup.error}</p> : null}
      </form>
    );
  }

  return (
    <ActionForm
      action={mfaEnableAction}
      className="max-w-md"
      render={(state) => {
        const codes = state.data?.recoveryCodes as string[] | undefined;
        return codes ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="mb-3">{labels.codes}</p>
            <ul dir="ltr" className="grid grid-cols-2 gap-1 font-mono">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        ) : null;
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      <p className="text-sm text-slate-600">{labels.key}</p>
      <code dir="ltr" className="block select-all break-all rounded-xl bg-slate-900 px-4 py-3 text-center font-mono text-sm tracking-widest text-white">{secret}</code>
      <Field label={labels.code} htmlFor="code"><Input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required dir="ltr" autoComplete="one-time-code" /></Field>
      <SubmitButton>{labels.enable}</SubmitButton>
    </ActionForm>
  );
}
