import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
  {
    variants: {
      tone: {
        default: 'border-[var(--border)] text-[var(--text)]',
        green: 'border-[var(--green)] text-[var(--green)]',
        red: 'border-[var(--red)] text-[var(--red)]',
        yellow: 'border-[var(--yellow)] text-[var(--yellow)]',
        blue: 'border-[var(--accent)] text-[var(--accent)]',
      },
    },
    defaultVariants: { tone: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function UiBadge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
