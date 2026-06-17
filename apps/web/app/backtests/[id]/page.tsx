'use client';

import { use, useEffect, useState } from 'react';
import { api, fmtJpy, fmtPct, fmtDate, pnlClass } from '@/lib/api';
import { Card, Stat, statusBadge } from '@/components/ui';
import { BacktestTabs } from '@/components/BacktestTabs';
import { EquityChart, DrawdownChart, ExposureChart, MonthlyChart } from '@/components/charts';

interface Summary {
  finalEquityJpy: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  tradeCount: number;
  averageHoldingDays: number;
  avgWinPct: number;
  avgLossPct: number;
  monthlyReturns: Array<{ month: string; returnPct: number }>;
}
interface Run {
  id: string;
  name: string;
  status: string;
  initialCapitalJpy: number;
  allowMargin: boolean;
  startDate: string;
  endDate: string;
  errorMessage: string | null;
  summaryJson: Summary | null;
  strategyVersion: { name: string };
}
interface Snapshot {
  snapshotDate: string;
  equityJpy: number;
  drawdownPct: number;
  exposurePct: number;
  cashJpy: number;
  marketValueJpy: number;
}

export default function BacktestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<Run | null>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api<Run>(`/api/backtests/${id}`).then(setRun);
    api<Snapshot[]>(`/api/backtests/${id}/snapshots`).then(setSnaps).catch(() => setSnaps([]));
  };
  useEffect(load, [id]);

  async function run_() {
    setBusy(true);
    try {
      await api(`/api/backtests/${id}/run`, { method: 'POST' });
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!run) return <p className="muted">読み込み中…</p>;
  const s = run.summaryJson;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p className="page-title">{run.name}</p>
          <p className="page-sub">
            {run.strategyVersion.name} · {fmtJpy(run.initialCapitalJpy)} · 信用{run.allowMargin ? 'ON' : 'OFF'} ·{' '}
            {fmtDate(run.startDate)}〜{fmtDate(run.endDate)} · {statusBadge(run.status)}
          </p>
        </div>
        {run.status !== 'completed' && (
          <button onClick={run_} disabled={busy}>
            {busy ? '実行中…' : 'バックテスト実行'}
          </button>
        )}
      </div>

      <BacktestTabs id={id} active="summary" />

      {run.errorMessage && <div className="warn">エラー: {run.errorMessage}</div>}
      {!s && run.status !== 'failed' && (
        <div className="warn">まだ結果がありません。「バックテスト実行」を押してください。</div>
      )}

      {s && (
        <>
          <div className="grid cols-4">
            <Stat label="最終資産" value={fmtJpy(s.finalEquityJpy)} />
            <Stat label="総リターン" value={fmtPct(s.totalReturnPct)} className={pnlClass(s.totalReturnPct)} />
            <Stat label="年率リターン" value={fmtPct(s.annualizedReturnPct)} className={pnlClass(s.annualizedReturnPct)} />
            <Stat label="最大ドローダウン" value={fmtPct(s.maxDrawdownPct)} className="neg" />
            <Stat label="勝率" value={fmtPct(s.winRatePct, 0)} />
            <Stat label="Profit Factor" value={s.profitFactor.toFixed(2)} />
            <Stat label="売買回数" value={s.tradeCount} />
            <Stat label="平均保有日数" value={`${s.averageHoldingDays.toFixed(0)}日`} />
          </div>

          <div style={{ marginTop: 16 }}>
            <Card title="資産推移">
              <EquityChart snapshots={snaps} />
            </Card>
          </div>
          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <Card title="ドローダウン">
              <DrawdownChart snapshots={snaps} />
            </Card>
            <Card title="エクスポージャー (%)">
              <ExposureChart snapshots={snaps} />
            </Card>
          </div>
          <div style={{ marginTop: 16 }}>
            <Card title="月次損益">
              <MonthlyChart data={s.monthlyReturns} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
