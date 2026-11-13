'use client';

import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from './ui';
import { cn } from '@/lib/cn';

export interface ActionState {
  error?: string;
  ok?: string;
  /** Extra data the page wants to show after success (e.g. recovery codes). */
  data?: Record<string, unknown>;
  /** Tells the form to reveal the MFA field. */
  needsMfa?: boolean;
}

export type FormAction = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function SubmitButton({ children, variant, size, className }: { children: ReactNode; variant?: 'primary' | 'ghost' | 'danger'; size?: 'md' | 'sm'; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending} className={className}>
      {pending ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </Button>
  );
}

export function ActionForm({
  action, children, className, render,
}: {
  action: FormAction;
  children?: ReactNode;
  className?: string;
  render?: (state: ActionState) => ReactNode;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={cn('space-y-4', className)} noValidate={false}>
      {children}
      {render?.(state)}
      {state.error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}
