import type { ReactNode } from 'react';
import { CardRoot, CardTitle } from '@/components/ui/card';
import { UiBadge } from '@/components/ui/badge';

type Tone = 'default' | 'green' | 'red' | 'yellow' | 'blue';

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <CardRoot>
      {title ? <CardTitle>{title}</CardTitle> : null}
      {children}
    </CardRoot>
  );
}

export function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <CardRoot className="stat">
      <div className="label">{label}</div>
      <div className={`value ${className ?? ''}`}>{value}</div>
    </CardRoot>
  );
}

export function Badge({ children, kind }: { children: ReactNode; kind?: string }) {
  const tone = (kind && kind !== '' ? kind : 'default') as Tone;
  return <UiBadge tone={tone}>{children}</UiBadge>;
}

export function statusBadge(status: string): ReactNode {
  const map: Record<string, Tone> = {
    completed: 'green',
    running: 'blue',
    pending: 'yellow',
    failed: 'red',
    filled: 'green',
    rejected: 'red',
    cancelled: 'yellow',
    champion: 'green',
    challenger: 'blue',
    archived: 'default',
    paused: 'yellow',
    stopped: 'default',
  };
  return <Badge kind={map[status] ?? 'default'}>{status}</Badge>;
}
