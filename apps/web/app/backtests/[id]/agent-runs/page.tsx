'use client';

import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';
import { BacktestTabs } from '@/components/BacktestTabs';

interface AgentRun {
  id: string;
  agentRole: string;
  taskType: string;
  modelName: string;
  inputJson: { candidates?: unknown[]; positions?: unknown[] };
  outputJson: { decisions?: Array<{ decision: string; symbol: string; reason: string }>; notes?: string };
  outputValid: boolean;
  createdAt: string;
}

export default function AgentRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selected, setSelected] = useState<AgentRun | null>(null);

  useEffect(() => {
    api<AgentRun[]>(`/api/backtests/${id}/agent-runs`).then((r) => {
      setRuns(r);
      const withDecision = r.find((x) => (x.outputJson.decisions?.length ?? 0) > 0);
      setSelected(withDecision ?? r[0] ?? null);
    });
  }, [id]);

  return (
    <div>
      <p className="page-title">AI判断ログ</p>
      <BacktestTabs id={id} active="agent-runs" />
      <p className="page-sub">{runs.length} 件のAgentRun（input/output を全て保存）</p>

      <div className="grid cols-2">
        <Card title="一覧">
          <div style={{ maxHeight: 600, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>タスク</th>
                  <th>判断数</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    style={{ cursor: 'pointer', background: selected?.id === r.id ? 'var(--panel-2)' : undefined }}
                  >
                    <td>{new Date(r.createdAt).toLocaleString('ja-JP')}</td>
                    <td>{r.taskType}</td>
                    <td>{r.outputJson.decisions?.length ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="詳細">
          {selected ? (
            <>
              <p>
                <strong>{selected.taskType}</strong> · {selected.agentRole} · {selected.modelName}
              </p>
              {selected.outputJson.notes && <p className="muted">notes: {selected.outputJson.notes}</p>}
              <h3 style={{ marginTop: 12 }}>decisions</h3>
              {(selected.outputJson.decisions ?? []).map((d, i) => (
                <div key={i} style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
                  <span className={d.decision === 'buy' ? 'pos' : d.decision === 'sell' ? 'neg' : 'muted'}>
                    {d.decision}
                  </span>{' '}
                  {d.symbol} — <span className="muted">{d.reason}</span>
                </div>
              ))}
              <h3 style={{ marginTop: 12 }}>input (AgentTaskContext)</h3>
              <pre>{JSON.stringify(selected.inputJson, null, 2)}</pre>
              <h3>output</h3>
              <pre>{JSON.stringify(selected.outputJson, null, 2)}</pre>
            </>
          ) : (
            <p className="muted">選択してください</p>
          )}
        </Card>
      </div>
    </div>
  );
}
