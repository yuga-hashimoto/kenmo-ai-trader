'use client';

import { use, useEffect, useState } from 'react';
import { api, fmtPct } from '@/lib/api';
import { Card, SymbolLink } from '@/components/ui';
import { BacktestTabs } from '@/components/BacktestTabs';

interface Features {
  earningsQuality?: { score: number; oneTimeProfitRisk: string } | null;
  gapOverheat?: { postEarningsGapPct: number; requiresFollowThrough: boolean } | null;
  followThrough?: { passed: boolean; reason: string } | null;
  marketRegime?: { regime: string; positionSizeMultiplier: number } | null;
  relativeStrength?: { score: number; relativeReturn20d: number } | null;
  doNotBuyReasons?: string[];
}
interface Trade {
  id: string;
  symbolCode: string;
  entryDate: string;
  strategy: string;
  featuresAtEntryJson: Features;
}

export default function AdvancedFiltersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [trades, setTrades] = useState<Trade[]>([]);
  useEffect(() => {
    api<Trade[]>(`/api/backtests/${id}/trades`).then(setTrades).catch(() => setTrades([]));
  }, [id]);

  return (
    <div>
      <p className="page-title">高度フィルター（各トレードのスコア）</p>
      <BacktestTabs id={id} active="advanced-filters" />
      <p className="page-sub">
        EarningsQuality / GapOverheat / FollowThrough / MarketRegime / RelativeStrength と doNotBuyReasons を建玉時点の値で表示。
      </p>
      <Card>
        <table>
          <thead>
            <tr>
              <th>銘柄</th>
              <th>建玉日</th>
              <th>戦略</th>
              <th>決算品質</th>
              <th>ギャップ%</th>
              <th>FollowThrough</th>
              <th>地合い</th>
              <th>相対強度</th>
              <th>doNotBuyReasons</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => {
              const f = t.featuresAtEntryJson ?? {};
              return (
                <tr key={t.id}>
                  <td><SymbolLink code={t.symbolCode} /></td>
                  <td>{t.entryDate.slice(0, 10)}</td>
                  <td className="muted">{t.strategy}</td>
                  <td>{f.earningsQuality ? `${f.earningsQuality.score} (${f.earningsQuality.oneTimeProfitRisk})` : '-'}</td>
                  <td>{f.gapOverheat ? fmtPct(f.gapOverheat.postEarningsGapPct) : '-'}</td>
                  <td>{f.followThrough ? (f.followThrough.passed ? '✓' : '✗') : '-'}</td>
                  <td>{f.marketRegime ? `${f.marketRegime.regime} ×${f.marketRegime.positionSizeMultiplier}` : '-'}</td>
                  <td>{f.relativeStrength ? f.relativeStrength.score.toFixed(0) : '-'}</td>
                  <td className="muted" style={{ maxWidth: 280 }}>
                    {(f.doNotBuyReasons ?? []).join(' / ') || '-'}
                  </td>
                </tr>
              );
            })}
            {trades.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">トレードがありません。</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
