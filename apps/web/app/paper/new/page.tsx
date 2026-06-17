'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Strategy {
  id: string;
  name: string;
  status: string;
}

export default function NewPaperPage() {
  const router = useRouter();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [initialCapitalJpy, setCapital] = useState(1_000_000);
  const [allowMargin, setMargin] = useState(false);
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

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>('/api/paper-runs', {
        method: 'POST',
        body: JSON.stringify({ initialCapitalJpy, allowMargin, strategyVersionId: strategyVersionId || undefined }),
      });
      await api(`/api/paper-runs/${created.id}/start`, { method: 'POST' });
      router.push(`/paper/${created.id}`);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="page-title">Paper運用 開始</p>
      <p className="page-sub">本番発注は行いません（疑似運用）。</p>
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="field">
          <label>元本 (JPY)</label>
          <input type="number" value={initialCapitalJpy} onChange={(e) => setCapital(Number(e.target.value))} />
        </div>
        <div className="field">
          <label>信用取引</label>
          <select value={allowMargin ? 'on' : 'off'} onChange={(e) => setMargin(e.target.value === 'on')}>
            <option value="off">OFF</option>
            <option value="on">ON</option>
          </select>
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
        <button disabled={busy} onClick={submit}>
          {busy ? '開始中…' : 'Paper運用を開始'}
        </button>
      </div>
    </div>
  );
}
