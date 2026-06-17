'use client';

import { use, useEffect, useState } from 'react';
import { api, fmtJpy, fmtPct, pnlClass } from '@/lib/api';
import { Card } from '@/components/ui';
import { BacktestTabs } from '@/components/BacktestTabs';

interface AblationResult {
  id: string;
  name: string;
  backtestRunId: string;
  finalEquityJpy: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
  tradeCount: number;
}

export default function AblationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [rows, setRows] = useState<AblationResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<AblationResult[]>(`/api/backtests/${id}/ablation`).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, [id]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/backtests/${id}/ablation`, { method: 'POST' });
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="page-title">Ablation Test</p>
        <button onClick={run} disabled={busy}>
          {busy ? '実行中…(約30秒)' : 'Ablationを実行'}
        </button>
      </div>
      <BacktestTabs id={id} active="ablation" />
      <p className="page-sub">
        同一期間で高度フィルターを1つずつ切り替えて再バックテスト。どの要素が損益に効いたかを比較します。
      </p>
      {error && <div className="warn">{error}</div>}
      <Card>
        <table>
          <thead>
            <tr>
              <th>構成</th>
              <th>最終資産</th>
              <th>総リターン</th>
              <th>年率</th>
              <th>最大DD</th>
              <th>勝率</th>
              <th>PF</th>
              <th>平均利益</th>
              <th>平均損失</th>
              <th>売買回数</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{fmtJpy(r.finalEquityJpy)}</td>
                <td className={pnlClass(r.totalReturnPct)}>{fmtPct(r.totalReturnPct)}</td>
                <td className={pnlClass(r.annualizedReturnPct)}>{fmtPct(r.annualizedReturnPct)}</td>
                <td className="neg">{fmtPct(r.maxDrawdownPct)}</td>
                <td>{fmtPct(r.winRatePct, 0)}</td>
                <td>{r.profitFactor >= 999 ? '∞' : r.profitFactor.toFixed(2)}</td>
                <td className="pos">{fmtPct(r.avgWinPct)}</td>
                <td className="neg">{fmtPct(r.avgLossPct)}</td>
                <td className={r.tradeCount < 5 ? 'neg' : ''}>{r.tradeCount}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  まだAblation結果がありません。「Ablationを実行」を押してください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {rows.length > 0 && (
          <p className="muted" style={{ marginTop: 10 }}>
            ※ 売買回数が極端に少ない構成は過剰最適化の疑い。勝率が上がっても finalEquity / PF が悪化する構成は採用しない。
          </p>
        )}
      </Card>
    </div>
  );
}
