import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${className ?? ''}`} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4 dark:border-stone-800 ${className ?? ''}`}
    >
      <div>
        <h3 className="text-sm font-semibold text-ink dark:text-stone-100">{title}</h3>
        {description && (
          <p className="mt-0.5 text-xs text-ink-muted dark:text-stone-400">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-5 py-4 ${className ?? ''}`} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`border-t border-stone-200 px-5 py-3 dark:border-stone-800 ${className ?? ''}`}
      {...rest}
    >
      {children}
    </div>
  );
}