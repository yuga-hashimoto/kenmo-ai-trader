'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtPct, pnlClass } from '@/lib/api';
import { Card, statusBadge } from '@/components/ui';

interface StrategyDetail {
  id: string;
  name: string;
  status: string;
  promptVersion: string;
  createdBy: string;
  createdReason: string | null;
  configJson: unknown;
  backtestRuns: Array<{ id: string; name: string; status: string; summaryJson: { totalReturnPct: number } | null }>;
  paperRuns: Array<{ id: string; name: string; status: string }>;
}

export default function StrategyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [s, setS] = useState<StrategyDetail | null>(null);
  useEffect(() => {
    api<StrategyDetail>(`/api/strategies/${id}`).then(setS);
  }, [id]);

  if (!s) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <p className="page-title">
        {s.name} {statusBadge(s.status)}
      </p>
      <p className="page-sub">
        {s.createdBy} · prompt {s.promptVersion} {s.createdReason ? `· ${s.createdReason}` : ''}
      </p>

      <div className="grid cols-2">
        <Card title="バックテスト結果">
          <table>
            <tbody>
              {s.backtestRuns.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/backtests/${b.id}`}>{b.name}</Link>
                  </td>
                  <td>{statusBadge(b.status)}</td>
                  <td className={pnlClass(b.summaryJson?.totalReturnPct)}>
                    {fmtPct(b.summaryJson?.totalReturnPct)}
                  </td>
                </tr>
              ))}
              {s.backtestRuns.length === 0 && (
                <tr>
                  <td className="muted">なし</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <Card title="Paper運用結果">
          <table>
            <tbody>
              {s.paperRuns.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/paper/${p.id}`}>{p.name}</Link>
                  </td>
                  <td>{statusBadge(p.status)}</td>
                </tr>
              ))}
              {s.paperRuns.length === 0 && (
                <tr>
                  <td className="muted">なし</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="configJson">
          <pre>{JSON.stringify(s.configJson, null, 2)}</pre>
        </Card>
      </div>
    </div>
  );
}
