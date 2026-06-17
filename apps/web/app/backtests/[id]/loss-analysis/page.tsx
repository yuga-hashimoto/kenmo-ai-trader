'use client';

import { use, useEffect, useState } from 'react';
import { api, fmtJpy, fmtPct } from '@/lib/api';
import { Card } from '@/components/ui';
import { BacktestTabs } from '@/components/BacktestTabs';

interface LossTypeStat {
  lossType: string;
  tradeCount: number;
  totalLossJpy: number;
  avgReturnPct: number;
  examples: string[];
}
interface FilterAttribution {
  filterName: string;
  tradeCount: number;
  avgReturnPct: number;
  winRatePct: number;
  profitFactor: number;
}
interface LossAnalysis {
  lossTypeStats: LossTypeStat[];
  filterAttribution: FilterAttribution[];
  proposalPreview: {
    reason: string;
    configChanges: Array<{ path: string; from: unknown; to: unknown; rationale: string }>;
  };
}

export default function LossAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<LossAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<LossAnalysis>(`/api/backtests/${id}/loss-analysis`).then(setData).catch((e) => setError(String(e)));
  }, [id]);

  return (
    <div>
      <p className="page-title">負け分析（LossType）</p>
      <BacktestTabs id={id} active="loss-analysis" />
      {error && <div className="warn">{error}</div>}
      {!data ? (
        <p className="muted">読み込み中…</p>
      ) : (
        <>
          <Card title="LossType別 集計">
            <table>
              <thead>
                <tr>
                  <th>LossType</th>
                  <th>件数</th>
                  <th>損失合計</th>
                  <th>平均リターン</th>
                  <th>代表銘柄</th>
                </tr>
              </thead>
              <tbody>
                {data.lossTypeStats.map((l) => (
                  <tr key={l.lossType}>
                    <td>{l.lossType}</td>
                    <td>{l.tradeCount}</td>
                    <td className="neg">{fmtJpy(l.totalLossJpy)}</td>
                    <td className="neg">{fmtPct(l.avgReturnPct)}</td>
                    <td className="muted">{l.examples.join(', ')}</td>
                  </tr>
                ))}
                {data.lossTypeStats.length === 0 && (
                  <tr><td colSpan={5} className="muted">負けトレードはありません。</td></tr>
                )}
              </tbody>
            </table>
          </Card>

          <div style={{ marginTop: 16 }}>
            <Card title="フィルター別アトリビューション">
              <table>
                <thead>
                  <tr>
                    <th>フィルター</th>
                    <th>適用トレード数</th>
                    <th>平均リターン</th>
                    <th>勝率</th>
                    <th>PF</th>
                  </tr>
                </thead>
                <tbody>
                  {data.filterAttribution.map((f) => (
                    <tr key={f.filterName}>
                      <td>{f.filterName}</td>
                      <td>{f.tradeCount}</td>
                      <td>{fmtPct(f.avgReturnPct)}</td>
                      <td>{fmtPct(f.winRatePct, 0)}</td>
                      <td>{f.profitFactor >= 999 ? '∞' : f.profitFactor.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <div style={{ marginTop: 16 }}>
            <Card title="AI改善提案プレビュー">
              <p className="muted">{data.proposalPreview.reason}</p>
              <table>
                <thead>
                  <tr><th>パラメータ</th><th>現在</th><th>提案</th><th>理由</th></tr>
                </thead>
                <tbody>
                  {data.proposalPreview.configChanges.map((c, i) => (
                    <tr key={i}>
                      <td><code>{c.path}</code></td>
                      <td>{String(c.from)}</td>
                      <td className="pos">{String(c.to)}</td>
                      <td className="muted">{c.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
