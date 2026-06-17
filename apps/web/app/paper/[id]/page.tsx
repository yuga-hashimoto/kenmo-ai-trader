'use client';

import { use, useEffect, useState } from 'react';
import { api, fmtJpy, fmtPct, fmtDate, pnlClass } from '@/lib/api';
import { Card, Stat, statusBadge } from '@/components/ui';
import { EquityChart } from '@/components/charts';

interface PaperRun {
  id: string;
  name: string;
  status: string;
  initialCapitalJpy: number;
  summaryJson: { finalEquityJpy: number; totalReturnPct: number; maxDrawdownPct: number; winRatePct: number } | null;
  strategyVersion: { name: string };
  openPositions: Array<{
    symbolCode: string;
    quantity: number;
    avgPrice: number;
    strategy: string;
    stopLossPrice: number | null;
  }>;
}
interface Snapshot {
  snapshotDate: string;
  equityJpy: number;
  drawdownPct: number;
  exposurePct: number;
  cashJpy: number;
  marketValueJpy: number;
}
interface Order {
  id: string;
  symbolCode: string;
  side: string;
  status: string;
  strategy: string;
  reason: string;
  createdAt: string;
  sessionTime: string | null;
  sessionType: string | null;
  executionPrice: number | null;
  executedQuantity: number | null;
}
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
}

export default function PaperDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<PaperRun | null>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api<PaperRun>(`/api/paper-runs/${id}`).then(setRun);
    api<Snapshot[]>(`/api/paper-runs/${id}/snapshots`).then(setSnaps).catch(() => setSnaps([]));
    api<Order[]>(`/api/paper-runs/${id}/orders`).then((o) => setOrders(o.filter((x) => x.status === 'filled').slice(-50).reverse())).catch(() => setOrders([]));
    api<Trade[]>(`/api/paper-runs/${id}/trades`).then((t) => setTrades(t.slice(-50).reverse())).catch(() => setTrades([]));
  };
  useEffect(load, [id]);

  async function act(action: string) {
    setBusy(true);
    try {
      await api(`/api/paper-runs/${id}/${action}`, { method: 'POST' });
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
            {run.strategyVersion.name} · {fmtJpy(run.initialCapitalJpy)} · {statusBadge(run.status)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={busy} onClick={() => act('go-live')}>
            ライブ開始
          </button>
          <button className="secondary" disabled={busy} onClick={() => act('step')}>
            1日進める
          </button>
          <button className="secondary" disabled={busy} onClick={() => act('pause')}>
            一時停止
          </button>
          <button className="secondary" disabled={busy} onClick={() => act('resume')}>
            再開
          </button>
          <button className="secondary" disabled={busy} onClick={() => act('stop')}>
            停止
          </button>
        </div>
      </div>

      {s && (
        <div className="grid cols-4">
          <Stat label="現在資産" value={fmtJpy(s.finalEquityJpy)} />
          <Stat label="損益" value={fmtPct(s.totalReturnPct)} className={pnlClass(s.totalReturnPct)} />
          <Stat label="最大DD" value={fmtPct(s.maxDrawdownPct)} className="neg" />
          <Stat label="勝率" value={fmtPct(s.winRatePct, 0)} />
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Card title="資産推移">
          <EquityChart snapshots={snaps} />
        </Card>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="保有銘柄">
          <table>
            <thead>
              <tr>
                <th>銘柄</th>
                <th>数量</th>
                <th>取得</th>
                <th>戦略</th>
                <th>損切り</th>
              </tr>
            </thead>
            <tbody>
              {run.openPositions.map((p) => (
                <tr key={p.symbolCode}>
                  <td>{p.symbolCode}</td>
                  <td>{p.quantity}</td>
                  <td>{fmtJpy(p.avgPrice)}</td>
                  <td className="muted">{p.strategy}</td>
                  <td>{fmtJpy(p.stopLossPrice)}</td>
                </tr>
              ))}
              {run.openPositions.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    保有なし
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <Card title="約定履歴（時刻・価格・数量）">
          <table>
            <thead>
              <tr>
                <th>日時</th>
                <th>銘柄</th>
                <th>売買</th>
                <th>約定価格</th>
                <th>数量</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    {fmtDate(o.createdAt)}
                    {o.sessionTime && <span className="muted"> {o.sessionTime}</span>}
                  </td>
                  <td>{o.symbolCode}</td>
                  <td className={o.side === 'buy' ? 'pos' : 'neg'}>{o.side === 'buy' ? '買' : '売'}</td>
                  <td>{fmtJpy(o.executionPrice)}</td>
                  <td>{o.executedQuantity ?? '-'}</td>
                  <td className="muted">{o.reason}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">約定なし</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="取引明細（買→売・損益）">
          <table>
            <thead>
              <tr>
                <th>銘柄</th>
                <th>戦略</th>
                <th>買った日</th>
                <th>買値</th>
                <th>売った日</th>
                <th>売値</th>
                <th>数量</th>
                <th>損益</th>
                <th>損益率</th>
                <th>保有日数</th>
                <th>決済理由</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id}>
                  <td>{t.symbolCode}</td>
                  <td className="muted">{t.strategy}</td>
                  <td>{fmtDate(t.entryDate)}</td>
                  <td>{fmtJpy(t.entryPrice)}</td>
                  <td>{t.exitDate ? fmtDate(t.exitDate) : <span className="muted">保有中</span>}</td>
                  <td>{fmtJpy(t.exitPrice)}</td>
                  <td>{t.quantity}</td>
                  <td className={pnlClass(t.pnlJpy)}>{t.pnlJpy === null ? '-' : fmtJpy(t.pnlJpy)}</td>
                  <td className={pnlClass(t.pnlPct)}>{t.pnlPct === null ? '-' : fmtPct(t.pnlPct)}</td>
                  <td>{t.holdingDays ?? '-'}</td>
                  <td className="muted">{t.exitReason ?? '-'}</td>
                </tr>
              ))}
              {trades.length === 0 && (
                <tr>
                  <td colSpan={11} className="muted">取引なし</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
