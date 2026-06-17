'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface Snapshot {
  snapshotDate: string;
  equityJpy: number;
  drawdownPct: number;
  exposurePct: number;
  cashJpy: number;
  marketValueJpy: number;
}

const axis = { stroke: '#8b94a7', fontSize: 11 };
const date = (d: string) => new Date(d).toISOString().slice(0, 10);

export function EquityChart({ snapshots }: { snapshots: Snapshot[] }) {
  const data = snapshots.map((s) => ({ date: date(s.snapshotDate), equity: Math.round(s.equityJpy) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f8cff" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#4f8cff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#2a3344" vertical={false} />
        <XAxis dataKey="date" tick={axis} minTickGap={40} />
        <YAxis tick={axis} width={70} domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={{ background: '#141925', border: '1px solid #2a3344', borderRadius: 8 }}
          formatter={(v: number) => `¥${v.toLocaleString()}`}
        />
        <Area type="monotone" dataKey="equity" stroke="#4f8cff" fill="url(#eq)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DrawdownChart({ snapshots }: { snapshots: Snapshot[] }) {
  const data = snapshots.map((s) => ({ date: date(s.snapshotDate), dd: -Math.abs(s.drawdownPct) }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <CartesianGrid stroke="#2a3344" vertical={false} />
        <XAxis dataKey="date" tick={axis} minTickGap={40} />
        <YAxis tick={axis} width={50} />
        <Tooltip
          contentStyle={{ background: '#141925', border: '1px solid #2a3344', borderRadius: 8 }}
          formatter={(v: number) => `${v.toFixed(1)}%`}
        />
        <Area type="monotone" dataKey="dd" stroke="#f85149" fill="#f85149" fillOpacity={0.2} strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ExposureChart({ snapshots }: { snapshots: Snapshot[] }) {
  const data = snapshots.map((s) => ({ date: date(s.snapshotDate), exposure: s.exposurePct }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid stroke="#2a3344" vertical={false} />
        <XAxis dataKey="date" tick={axis} minTickGap={40} />
        <YAxis tick={axis} width={50} />
        <Tooltip
          contentStyle={{ background: '#141925', border: '1px solid #2a3344', borderRadius: 8 }}
          formatter={(v: number) => `${v.toFixed(0)}%`}
        />
        <Line type="monotone" dataKey="exposure" stroke="#d29922" dot={false} strokeWidth={1.5} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MonthlyChart({
  data,
}: {
  data: Array<{ month: string; returnPct: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <CartesianGrid stroke="#2a3344" vertical={false} />
        <XAxis dataKey="month" tick={axis} minTickGap={20} />
        <YAxis tick={axis} width={50} />
        <Tooltip
          contentStyle={{ background: '#141925', border: '1px solid #2a3344', borderRadius: 8 }}
          formatter={(v: number) => `${v.toFixed(1)}%`}
        />
        <Bar dataKey="returnPct" fill="#3fb950" />
      </BarChart>
    </ResponsiveContainer>
  );
}
