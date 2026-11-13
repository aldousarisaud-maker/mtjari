'use client';

import { ActionForm, SubmitButton } from '@/components/action-form';
import { Field, Input } from '@/components/ui';
import { loginAction } from '@/app/actions';

export function LoginForm({ locale, next, labels }: { locale: string; next: string; labels: { email: string; password: string; mfa: string; cta: string } }) {
  return (
    <ActionForm
      action={loginAction}
      render={(state) =>
        state.needsMfa ? (
          <Field label={labels.mfa} htmlFor="mfaCode">
            <Input id="mfaCode" name="mfaCode" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" autoFocus dir="ltr" />
          </Field>
        ) : null
      }
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
      <Field label={labels.email} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" />
      </Field>
      <Field label={labels.password} htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" />
      </Field>
      <SubmitButton className="w-full">{labels.cta}</SubmitButton>
    </ActionForm>
  );
}
