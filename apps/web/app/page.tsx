'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtPct, fmtDate, pnlClass } from '@/lib/api';
import { Card, Stat, statusBadge } from '@/components/ui';

interface Dashboard {
  counts: { backtests: number; paperRuns: number; strategies: number };
  latestBacktests: Array<{
    id: string;
    name: string;
    status: string;
    summaryJson: { totalReturnPct: number; maxDrawdownPct: number } | null;
    strategyVersion: { name: string };
  }>;
  runningPaper: Array<{ id: string; name: string; status: string }>;
  champion: { id: string; name: string; promptVersion: string } | null;
  recentAgentRuns: Array<{ id: string; taskType: string; createdAt: string }>;
  recentOrders: Array<{
    id: string;
    symbolCode: string;
    side: string;
    strategy: string;
    reason: string;
    createdAt: string;
  }>;
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Dashboard>('/api/dashboard/summary').then(setData).catch((e) => setError(String(e)));
  }, []);

  if (error)
    return (
      <div>
        <p className="page-title">ダッシュボード</p>
        <div className="warn">API接続エラー: {error}。APIが起動しseedが投入済みか確認してください。</div>
      </div>
    );
  if (!data) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <p className="page-title">ダッシュボード</p>
      <p className="page-sub">HermesAgentによる自動売買の全体状況</p>

      <div className="grid cols-4">
        <Stat label="バックテスト" value={data.counts.backtests} />
        <Stat label="Paper運用" value={data.counts.paperRuns} />
        <Stat label="戦略バージョン" value={data.counts.strategies} />
        <Stat
          label="Champion戦略"
          value={data.champion ? data.champion.name : '-'}
          className="pos"
        />
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="最新バックテスト">
          <table>
            <thead>
              <tr>
                <th>名前</th>
                <th>状態</th>
                <th>リターン</th>
                <th>最大DD</th>
              </tr>
            </thead>
            <tbody>
              {data.latestBacktests.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/backtests/${b.id}`}>{b.name}</Link>
                  </td>
                  <td>{statusBadge(b.status)}</td>
                  <td className={pnlClass(b.summaryJson?.totalReturnPct)}>
                    {fmtPct(b.summaryJson?.totalReturnPct)}
                  </td>
                  <td className="neg">{fmtPct(b.summaryJson?.maxDrawdownPct)}</td>
                </tr>
              ))}
              {data.latestBacktests.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    まだありません。<Link href="/backtests/new">作成する</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card title="稼働中Paper運用">
          {data.runningPaper.length === 0 ? (
            <p className="muted">稼働中のPaper運用はありません。</p>
          ) : (
            <table>
              <tbody>
                {data.runningPaper.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/paper/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{statusBadge(p.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="最近の約定">
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>銘柄</th>
                <th>売買</th>
                <th>戦略</th>
              </tr>
            </thead>
            <tbody>
              {data.recentOrders.map((o) => (
                <tr key={o.id}>
                  <td>{fmtDate(o.createdAt)}</td>
                  <td>{o.symbolCode}</td>
                  <td className={o.side === 'buy' ? 'pos' : 'neg'}>{o.side}</td>
                  <td className="muted">{o.strategy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="最近のAI判断">
          <table>
            <thead>
              <tr>
                <th>日時</th>
                <th>タスク</th>
              </tr>
            </thead>
            <tbody>
              {data.recentAgentRuns.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.createdAt).toLocaleString('ja-JP')}</td>
                  <td>{a.taskType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
