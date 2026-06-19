'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtJpy, fmtPct, fmtDate, pnlClass } from '@/lib/api';
import { BacktestTabs } from '@/components/BacktestTabs';
import { SymbolLink } from '@/components/ui';

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
  exitReason: string | null;
}

export default function TradesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [trades, setTrades] = useState<Trade[]>([]);
  useEffect(() => {
    api<Trade[]>(`/api/backtests/${id}/trades`).then(setTrades).catch(() => setTrades([]));
  }, [id]);

  return (
    <div>
      <p className="page-title">売買履歴</p>
      <BacktestTabs id={id} active="trades" />
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>銘柄</th>
              <th>戦略</th>
              <th>建玉日</th>
              <th>決済日</th>
              <th>取得</th>
              <th>決済</th>
              <th>数量</th>
              <th>損益</th>
              <th>損益率</th>
              <th>保有</th>
              <th>決済理由</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id}>
                <td>
                  <SymbolLink code={t.symbolCode} />{' '}
                  <Link href={`/backtests/${id}/trades/${t.id}`} className="muted" style={{ fontSize: 12 }}>
                    詳細
                  </Link>
                </td>
                <td className="muted">{t.strategy}</td>
                <td>{fmtDate(t.entryDate)}</td>
                <td>{fmtDate(t.exitDate)}</td>
                <td>{fmtJpy(t.entryPrice)}</td>
                <td>{fmtJpy(t.exitPrice)}</td>
                <td>{t.quantity}</td>
                <td className={pnlClass(t.pnlJpy)}>{fmtJpy(t.pnlJpy)}</td>
                <td className={pnlClass(t.pnlPct)}>{fmtPct(t.pnlPct)}</td>
                <td>{t.holdingDays ?? '-'}日</td>
                <td className="muted">{t.exitReason ?? '保有中'}</td>
              </tr>
            ))}
            {trades.length === 0 && (
              <tr>
                <td colSpan={11} className="muted">
                  トレードがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
