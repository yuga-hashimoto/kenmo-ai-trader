'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtJpy, fmtPct, fmtDate, pnlClass } from '@/lib/api';
import { statusBadge } from '@/components/ui';

interface BacktestRow {
  id: string;
  name: string;
  initialCapitalJpy: number;
  allowMargin: boolean;
  startDate: string;
  endDate: string;
  status: string;
  summaryJson: {
    finalEquityJpy: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    winRatePct: number;
  } | null;
  strategyVersion: { name: string };
}

export default function BacktestsPage() {
  const [rows, setRows] = useState<BacktestRow[]>([]);
  const load = () => api<BacktestRow[]>('/api/backtests').then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="page-title">バックテスト</p>
        <Link className="btn" href="/backtests/new">
          ＋ 新規作成
        </Link>
      </div>
      <p className="page-sub">HermesAgentが仮想スケジューラ上でkenmo式に自動売買した結果</p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>名前</th>
              <th>戦略</th>
              <th>元本</th>
              <th>信用</th>
              <th>期間</th>
              <th>最終資産</th>
              <th>損益</th>
              <th>最大DD</th>
              <th>勝率</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/backtests/${r.id}`}>{r.name}</Link>
                </td>
                <td className="muted">{r.strategyVersion.name}</td>
                <td>{fmtJpy(r.initialCapitalJpy)}</td>
                <td>{r.allowMargin ? 'ON' : 'OFF'}</td>
                <td className="muted">
                  {fmtDate(r.startDate)}〜{fmtDate(r.endDate)}
                </td>
                <td>{fmtJpy(r.summaryJson?.finalEquityJpy)}</td>
                <td className={pnlClass(r.summaryJson?.totalReturnPct)}>
                  {fmtPct(r.summaryJson?.totalReturnPct)}
                </td>
                <td className="neg">{fmtPct(r.summaryJson?.maxDrawdownPct)}</td>
                <td>{fmtPct(r.summaryJson?.winRatePct, 0)}</td>
                <td>{statusBadge(r.status)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  まだバックテストがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
