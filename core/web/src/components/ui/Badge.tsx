import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warn'
  | 'danger'
  | 'pending'
  | 'uploading'
  | 'published'
  | 'failed'
  | 'dead';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-100',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
  danger: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
  pending: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  uploading: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  published: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  failed: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
  dead: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  ...rest
}: { tone?: BadgeTone; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`chip ${TONE[tone]} ${className ?? ''}`} {...rest}>
      {children}
    </span>
  );
}

export function statusToTone(status: string): BadgeTone {
  switch (status) {
    case 'published':
      return 'published';
    case 'pending':
      return 'pending';
    case 'uploading':
      return 'uploading';
    case 'failed':
      return 'failed';
    case 'dead':
      return 'dead';
    default:
      return 'neutral';
  }
}