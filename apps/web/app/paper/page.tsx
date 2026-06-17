'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtJpy, fmtPct, pnlClass } from '@/lib/api';
import { statusBadge } from '@/components/ui';

interface PaperRow {
  id: string;
  name: string;
  initialCapitalJpy: number;
  allowMargin: boolean;
  status: string;
  summaryJson: { finalEquityJpy: number; totalReturnPct: number } | null;
  strategyVersion: { name: string };
}

export default function PaperPage() {
  const [rows, setRows] = useState<PaperRow[]>([]);
  useEffect(() => {
    api<PaperRow[]>('/api/paper-runs').then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="page-title">Paper運用</p>
        <Link className="btn" href="/paper/new">
          ＋ 新規Paper
        </Link>
      </div>
      <p className="page-sub">
        実際の証券APIには発注しません。MarketDataProviderの価格でAIが疑似運用します。
      </p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>名前</th>
              <th>戦略</th>
              <th>元本</th>
              <th>状態</th>
              <th>現在資産</th>
              <th>損益</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/paper/${r.id}`}>{r.name}</Link>
                </td>
                <td className="muted">{r.strategyVersion.name}</td>
                <td>{fmtJpy(r.initialCapitalJpy)}</td>
                <td>{statusBadge(r.status)}</td>
                <td>{fmtJpy(r.summaryJson?.finalEquityJpy)}</td>
                <td className={pnlClass(r.summaryJson?.totalReturnPct)}>
                  {fmtPct(r.summaryJson?.totalReturnPct)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Paper運用がありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
