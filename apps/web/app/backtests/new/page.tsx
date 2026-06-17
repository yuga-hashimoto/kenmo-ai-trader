'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Strategy {
  id: string;
  name: string;
  status: string;
}

export default function NewBacktestPage() {
  const router = useRouter();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [initialCapitalJpy, setCapital] = useState(1_000_000);
  const [allowMargin, setMargin] = useState(false);
  const [startDate, setStart] = useState('2022-01-04');
  const [endDate, setEnd] = useState('2023-12-29');
  const [strategyVersionId, setStrategy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Strategy[]>('/api/strategies').then((s) => {
      setStrategies(s);
      const champ = s.find((x) => x.status === 'champion') ?? s[0];
      if (champ) setStrategy(champ.id);
    });
  }, []);

  async function submit(run: boolean) {
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>('/api/backtests', {
        method: 'POST',
        body: JSON.stringify({
          initialCapitalJpy,
          allowMargin,
          startDate,
          endDate,
          strategyVersionId: strategyVersionId || undefined,
        }),
      });
      if (run) {
        await api(`/api/backtests/${created.id}/run`, { method: 'POST' });
      }
      router.push(`/backtests/${created.id}`);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="page-title">バックテスト作成</p>
      <p className="page-sub">元本・信用・期間・戦略を選んで開始します</p>

      <div className="card" style={{ maxWidth: 520 }}>
        <div className="field">
          <label>元本 (JPY)</label>
          <input
            type="number"
            value={initialCapitalJpy}
            onChange={(e) => setCapital(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>信用取引</label>
          <select value={allowMargin ? 'on' : 'off'} onChange={(e) => setMargin(e.target.value === 'on')}>
            <option value="off">OFF（現物のみ）</option>
            <option value="on">ON（最大レバレッジ2.0倍）</option>
          </select>
        </div>
        <div className="grid cols-2">
          <div className="field">
            <label>開始日</label>
            <input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label>終了日</label>
            <input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>戦略バージョン</label>
          <select value={strategyVersionId} onChange={(e) => setStrategy(e.target.value)}>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.status})
              </option>
            ))}
          </select>
        </div>

        {error && <div className="warn" style={{ marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={busy} onClick={() => submit(true)}>
            {busy ? '実行中…' : '作成して実行'}
          </button>
          <button className="secondary" disabled={busy} onClick={() => submit(false)}>
            作成のみ
          </button>
        </div>
      </div>
    </div>
  );
}
