import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-surface px-6 py-12 text-center dark:border-stone-700 dark:bg-[#211d18]">
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-ink-muted dark:bg-stone-800 dark:text-stone-400">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-ink dark:text-stone-100">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-ink-muted dark:text-stone-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}