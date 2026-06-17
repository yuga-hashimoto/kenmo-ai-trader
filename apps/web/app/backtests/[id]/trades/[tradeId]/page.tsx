'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtJpy, fmtPct, fmtDate, pnlClass } from '@/lib/api';
import { Card, Stat } from '@/components/ui';

interface Trade {
  id: string;
  symbolCode: string;
  strategy: string;
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnlJpy: number | null;
  pnlPct: number | null;
  holdingDays: number | null;
  entryReason: string;
  exitReason: string | null;
  thesis: string | null;
  lossType: string | null;
  invalidationConditionsJson: string[] | null;
  featuresAtEntryJson: Record<string, unknown> & { doNotBuyReasons?: string[] };
  maxFavorableExcursionPct: number | null;
  maxAdverseExcursionPct: number | null;
  aiReviewJson: unknown;
}

export default function TradeDetail({
  params,
}: {
  params: Promise<{ id: string; tradeId: string }>;
}) {
  const { id, tradeId } = use(params);
  const [t, setT] = useState<Trade | null>(null);
  useEffect(() => {
    api<Trade>(`/api/backtests/${id}/trades/${tradeId}`).then(setT);
  }, [id, tradeId]);

  if (!t) return <p className="muted">読み込み中…</p>;

  const block = (name: string): Record<string, unknown> | null => {
    const v = t.featuresAtEntryJson?.[name];
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  };
  const fScore = (name: string, key: string): string => {
    const b = block(name);
    const v = b?.[key];
    return typeof v === 'number' ? v.toFixed(1) : '—';
  };
  const fBool = (name: string, key: string): string => {
    const b = block(name);
    if (!b) return '—';
    return b[key] ? '✓' : '✗';
  };
  const fStr = (name: string, key: string): string => {
    const b = block(name);
    const v = b?.[key];
    return typeof v === 'string' ? v : '—';
  };

  return (
    <div>
      <p className="page-title">
        {t.symbolCode} <span className="muted">トレード詳細</span>
      </p>
      <p className="page-sub">
        <Link href={`/backtests/${id}/trades`}>← 売買履歴へ戻る</Link>
      </p>

      <div className="grid cols-4">
        <Stat label="損益" value={fmtJpy(t.pnlJpy)} className={pnlClass(t.pnlJpy)} />
        <Stat label="損益率" value={fmtPct(t.pnlPct)} className={pnlClass(t.pnlPct)} />
        <Stat label="保有日数" value={`${t.holdingDays ?? '-'}日`} />
        <Stat label="戦略" value={t.strategy} />
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="エントリー">
          <p>日付: {fmtDate(t.entryDate)}</p>
          <p>取得単価: {fmtJpy(t.entryPrice)} × {t.quantity}</p>
          <p className="muted">理由: {t.entryReason}</p>
        </Card>
        <Card title="エグジット">
          <p>日付: {fmtDate(t.exitDate)}</p>
          <p>決済単価: {fmtJpy(t.exitPrice)}</p>
          <p className="muted">理由: {t.exitReason ?? '保有中'}</p>
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="thesis（投資仮説）">
          <p>{t.thesis || '—'}</p>
        </Card>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="invalidation conditions（撤退条件）">
          <ul>
            {(t.invalidationConditionsJson ?? []).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
            {(!t.invalidationConditionsJson || t.invalidationConditionsJson.length === 0) && (
              <li className="muted">—</li>
            )}
          </ul>
        </Card>
        <Card title="MFE / MAE">
          <p>最大含み益 (MFE): {fmtPct(t.maxFavorableExcursionPct)}</p>
          <p>最大含み損 (MAE): {fmtPct(t.maxAdverseExcursionPct)}</p>
        </Card>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="高度フィルター（建玉時点）">
          <table>
            <tbody>
              <tr><td className="muted">LossType</td><td>{t.lossType ?? '— (勝ち/未該当)'}</td></tr>
              <tr><td className="muted">決算品質</td><td>{fScore('earningsQuality', 'score')}</td></tr>
              <tr><td className="muted">決算ギャップ%</td><td>{fScore('gapOverheat', 'postEarningsGapPct')}</td></tr>
              <tr><td className="muted">FollowThrough</td><td>{fBool('followThrough', 'passed')}</td></tr>
              <tr><td className="muted">地合い</td><td>{fStr('marketRegime', 'regime')}</td></tr>
              <tr><td className="muted">相対強度スコア</td><td>{fScore('relativeStrength', 'score')}</td></tr>
            </tbody>
          </table>
        </Card>
        <Card title="doNotBuyReasons">
          <ul>
            {(t.featuresAtEntryJson?.doNotBuyReasons ?? []).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
            {(!t.featuresAtEntryJson?.doNotBuyReasons ||
              t.featuresAtEntryJson.doNotBuyReasons.length === 0) && <li className="muted">—</li>}
          </ul>
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="features at entry (raw)">
          <pre>{JSON.stringify(t.featuresAtEntryJson, null, 2)}</pre>
        </Card>
      </div>

      {t.aiReviewJson ? (
        <div style={{ marginTop: 16 }}>
          <Card title="AI review">
            <pre>{JSON.stringify(t.aiReviewJson, null, 2)}</pre>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
