'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDate } from '@/lib/api';
import { Card, statusBadge } from '@/components/ui';

interface Strategy {
  id: string;
  name: string;
  status: string;
  promptVersion: string;
  createdBy: string;
  createdReason: string | null;
  createdAt: string;
  _count: { backtestRuns: number; paperRuns: number };
}

export default function StrategiesPage() {
  const [rows, setRows] = useState<Strategy[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => api<Strategy[]>('/api/strategies').then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);

  async function promote(id: string) {
    setBusy(true);
    try {
      await api(`/api/strategies/${id}/promote`, { method: 'POST' });
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="page-title">戦略 (Champion / Challenger)</p>
      <p className="page-sub">AIが生成したChallengerをバックテストで比較し、優れていればChampionへ昇格できます。</p>
      <Card>
        <table>
          <thead>
            <tr>
              <th>名前</th>
              <th>状態</th>
              <th>作成者</th>
              <th>prompt</th>
              <th>BT / Paper</th>
              <th>作成日</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/strategies/${s.id}`}>{s.name}</Link>
                </td>
                <td>{statusBadge(s.status)}</td>
                <td className="muted">{s.createdBy}</td>
                <td className="muted">{s.promptVersion}</td>
                <td>
                  {s._count.backtestRuns} / {s._count.paperRuns}
                </td>
                <td className="muted">{fmtDate(s.createdAt)}</td>
                <td>
                  {s.status !== 'champion' && (
                    <button className="secondary" disabled={busy} onClick={() => promote(s.id)}>
                      Championに昇格
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
