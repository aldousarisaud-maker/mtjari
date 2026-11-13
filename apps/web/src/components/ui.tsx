import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; size?: 'md' | 'sm' };

export const buttonClass = ({ variant = 'primary', size = 'md' }: Pick<ButtonProps, 'variant' | 'size'> = {}) =>
  cn(
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]',
    size === 'md' ? 'h-11 px-5 text-sm' : 'h-8 px-3 text-xs',
    variant === 'primary' && 'bg-primary text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,0.7)] hover:bg-primary-600',
    variant === 'ghost' && 'bg-white/60 text-slate-700 border border-slate-200 hover:bg-white dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700',
    variant === 'danger' && 'bg-white/60 text-red-600 border border-red-200 hover:bg-red-50 dark:bg-transparent dark:border-red-900',
  );

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonClass({ variant, size }), className)} {...props} />;
}

const field =
  'h-11 w-full rounded-xl border border-slate-200 bg-white/80 px-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/15 dark:bg-slate-900/60 dark:border-slate-700 dark:text-slate-100';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, 'appearance-auto', className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300', className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('glass p-6', className)} {...props} />;
}

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary', className)} {...props} />;
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="mt-1.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
