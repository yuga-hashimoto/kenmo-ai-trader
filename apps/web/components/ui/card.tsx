import * as React from 'react';
import { cn } from '@/lib/utils';

export const CardRoot = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4',
        className,
      )}
      {...props}
    />
  ),
);
CardRoot.displayName = 'CardRoot';

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('mb-3 text-sm font-semibold text-[var(--muted)]', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';
