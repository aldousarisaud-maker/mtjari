'use client';

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type FormEvent, type ReactNode } from 'react';
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

const PendingContext = createContext(false);

export function SubmitButton({ children, variant, size, className }: { children: ReactNode; variant?: 'primary' | 'ghost' | 'danger'; size?: 'md' | 'sm'; className?: string }) {
  const status = useFormStatus();
  const pending = useContext(PendingContext) || status.pending;
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending} className={className}>
      {pending ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </Button>
  );
}

const INITIAL: ActionState = {};

export function ActionForm({
  action, children, className, render,
}: {
  action: FormAction;
  children?: ReactNode;
  className?: string;
  render?: (state: ActionState) => ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const ref = useRef<HTMLFormElement>(null);
  // React clears a form after every action. We submit it ourselves so that a
  // rejected form keeps what the merchant typed; it is cleared only on success.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Include the button that was pressed, so forms with several actions know which one.
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(data));
  }
  useEffect(() => {
    if (!pending && state !== INITIAL && !state.error && !state.needsMfa) ref.current?.reset();
  }, [state, pending]);
  return (
    <form ref={ref} action={formAction} onSubmit={onSubmit} className={cn('space-y-4', className)} noValidate={false}>
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
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
