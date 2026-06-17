'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Card, statusBadge } from '@/components/ui';
import { BacktestTabs } from '@/components/BacktestTabs';

interface Proposal {
  id: string;
  reason: string;
  status: string;
  challengerStrategyVersionId: string | null;
  proposalJson: {
    summary: string;
    bestPatterns: string[];
    worstPatterns: string[];
    configChanges: Array<{ path: string; from: unknown; to: unknown; rationale: string }>;
    promptNotes: string;
  };
  createdAt: string;
}

export default function EvolutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<Proposal[]>(`/api/backtests/${id}/evolution`).then(setProposals).catch(() => setProposals([]));
  useEffect(() => {
    load();
  }, [id]);

  async function evolve() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/backtests/${id}/evolve`, { method: 'POST' });
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
        <p className="page-title">AI改善 / Challenger</p>
        <button onClick={evolve} disabled={busy}>
          {busy ? '生成中…' : 'AIで改善案を生成'}
        </button>
      </div>
      <BacktestTabs id={id} active="evolution" />
      <p className="page-sub">
        HermesAgentがバックテスト結果をレビューし、Challenger戦略バージョンを作成します（要：完了済みバックテスト）。
      </p>
      {error && <div className="warn">{error}</div>}

      {proposals.length === 0 && <p className="muted">まだ改善提案がありません。</p>}

      {proposals.map((p) => (
        <div key={p.id} style={{ marginBottom: 16 }}>
          <Card title={`提案 ${p.createdAt.slice(0, 10)} ${'·'} ${p.status}`}>
            <p>{p.reason}</p>
            <p className="muted">{p.proposalJson.summary}</p>
            {p.challengerStrategyVersionId && (
              <p>
                Challenger:{' '}
                <Link href={`/strategies/${p.challengerStrategyVersionId}`}>
                  {p.challengerStrategyVersionId.slice(0, 12)}
                </Link>{' '}
                {statusBadge('challenger')}
              </p>
            )}
            <h3 style={{ marginTop: 12 }}>変更内容</h3>
            <table>
              <thead>
                <tr>
                  <th>パラメータ</th>
                  <th>変更前</th>
                  <th>変更後</th>
                  <th>理由</th>
                </tr>
              </thead>
              <tbody>
                {p.proposalJson.configChanges.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <code>{c.path}</code>
                    </td>
                    <td>{String(c.from)}</td>
                    <td className="pos">{String(c.to)}</td>
                    <td className="muted">{c.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid cols-2" style={{ marginTop: 12 }}>
              <div>
                <h3>勝ちパターン</h3>
                <ul>
                  {p.proposalJson.bestPatterns.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>負けパターン</h3>
                <ul>
                  {p.proposalJson.worstPatterns.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}
