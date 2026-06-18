'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtJpy, fmtPct, fmtDate, pnlClass } from '@/lib/api';
import { EquityChart } from '@/components/charts';

type Stance = 'cautious' | 'balanced' | 'aggressive';

interface Run {
  id: string;
  name: string;
  status: string;
  initialCapitalJpy: number;
  summaryJson: {
    finalEquityJpy: number;
    totalReturnPct: number;
    winRatePct: number;
    tradeCount: number;
    lastProcessedDate?: string;
  } | null;
}
interface Holding {
  symbolCode: string;
  name: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  marketValueJpy: number;
  pnlJpy: number;
  pnlPct: number;
}
interface Snapshot {
  snapshotDate: string;
  equityJpy: number;
  drawdownPct: number;
  exposurePct: number;
  cashJpy: number;
  marketValueJpy: number;
}
interface Trade {
  id: string;
  symbolCode: string;
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnlJpy: number | null;
  exitReason: string | null;
  entryReason: string;
}
interface Guidance {
  current: { stance: string; text: string; createdAt: string } | null;
  history: Array<{ id: string; stance: string; text: string; createdAt: string }>;
}

const STANCE_LABEL: Record<Stance, string> = {
  cautious: '慎重',
  balanced: 'ふつう',
  aggressive: '積極的',
};

function relativeTime(d: string | null | undefined): string {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

export default function Home() {
  const [run, setRun] = useState<Run | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [alive, setAlive] = useState<{ running: boolean } | null>(null);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [stance, setStance] = useState<Stance>('balanced');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const runs = await api<Run[]>('/api/paper-runs');
      const active = runs.find((r) => r.status === 'running') ?? runs[0] ?? null;
      setRun(active);
      if (active) {
        api<{ openPositions: Holding[] }>(`/api/paper-runs/${active.id}`)
          .then((d) => setHoldings(d.openPositions ?? []))
          .catch(() => setHoldings([]));
        api<Snapshot[]>(`/api/paper-runs/${active.id}/snapshots`).then(setSnaps).catch(() => setSnaps([]));
        api<Trade[]>(`/api/paper-runs/${active.id}/trades`)
          .then((t) => setTrades(t.filter((x) => x.exitDate).slice(-30).reverse()))
          .catch(() => setTrades([]));
      }
      api<{ running: boolean }>('/api/scheduler/status').then(setAlive).catch(() => setAlive(null));
      api<Guidance>('/api/guidance')
        .then((g) => {
          setGuidance(g);
          if (g.current) {
            setStance((g.current.stance as Stance) ?? 'balanced');
            setNotes(g.current.text ?? '');
          }
        })
        .catch(() => setGuidance(null));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000); // refresh for a near real-time feel
    return () => clearInterval(t);
  }, [load]);

  async function saveGuidance() {
    setSaving(true);
    try {
      await api('/api/guidance', { method: 'POST', body: JSON.stringify({ stance, text: notes }) });
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <p className="muted">読み込み中…</p>;

  if (!run) {
    return (
      <div>
        <p className="page-title">AIにおまかせ運用</p>
        <div className="card" style={{ marginTop: 12 }}>
          <p>まだ運用が始まっていません。</p>
          <p className="muted">
            <Link href="/paper">Paper運用</Link> から「ライブ開始」で、AIの自動売買がスタートします。
          </p>
        </div>
      </div>
    );
  }

  const s = run.summaryJson;
  const equity = s?.finalEquityJpy ?? run.initialCapitalJpy;
  const profit = equity - run.initialCapitalJpy;
  const up = profit >= 0;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      {/* status line */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <p className="page-title" style={{ margin: 0 }}>AIにおまかせ運用</p>
        <span className="muted" style={{ fontSize: 13 }}>
          {alive?.running ? '🟢 AIが稼働中' : '⚪️ 停止中'}
          {snaps.length > 0 ? ` ・ 最終更新 ${relativeTime(snaps.at(-1)?.snapshotDate)}` : ''}
        </span>
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        これは練習（Paper）です。本物のお金は使っていません。
      </p>

      {/* ① 結果 */}
      <div className="card" style={{ textAlign: 'center', padding: '28px 16px' }}>
        <div className="muted" style={{ fontSize: 14 }}>いまの資産</div>
        <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.1, margin: '6px 0' }}>{fmtJpy(equity)}</div>
        <div className={pnlClass(profit)} style={{ fontSize: 20, fontWeight: 600 }}>
          {up ? '▲ +' : '▼ '}{fmtJpy(profit)}（{up ? '+' : ''}{fmtPct(s?.totalReturnPct ?? 0)}）
          <span style={{ fontSize: 14, marginLeft: 8 }}>{up ? '増えています' : '減っています'}</span>
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          元手 {fmtJpy(run.initialCapitalJpy)} ・ 勝率 {fmtPct(s?.winRatePct ?? 0, 0)} ・ 取引 {s?.tradeCount ?? 0}回
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3>お金の推移</h3>
        {snaps.length > 1 ? <EquityChart snapshots={snaps} /> : <p className="muted">まだグラフを描くデータがありません。</p>}
      </div>

      {/* 今持っている株 */}
      <div className="card" style={{ marginTop: 12 }}>
        <h3>いま持っている株</h3>
        {holdings.length === 0 ? (
          <p className="muted">今は何も持っていません（現金で待機中）。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>銘柄</th>
                <th>数量</th>
                <th>今の評価額</th>
                <th>損益</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.symbolCode}>
                  <td>{h.name}<span className="muted"> {h.symbolCode}</span></td>
                  <td>{h.quantity}株</td>
                  <td>{fmtJpy(h.marketValueJpy)}</td>
                  <td className={pnlClass(h.pnlJpy)}>
                    {h.pnlJpy >= 0 ? '+' : ''}{fmtJpy(h.pnlJpy)}（{h.pnlJpy >= 0 ? '+' : ''}{fmtPct(h.pnlPct)}）
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ② 履歴 */}
      <div className="card" style={{ marginTop: 12 }}>
        <h3>売買の履歴（AIがやったこと）</h3>
        {trades.length === 0 ? (
          <p className="muted">まだ売買が完了していません。</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {trades.map((t) => {
              const win = (t.pnlJpy ?? 0) >= 0;
              return (
                <div key={t.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span><b>{t.symbolCode}</b> を {t.quantity}株</span>
                    <span className={pnlClass(t.pnlJpy)} style={{ fontWeight: 600 }}>
                      {win ? '+' : ''}{fmtJpy(t.pnlJpy)} {win ? '儲かりました' : '損しました'}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {fmtDate(t.entryDate)} に {fmtJpy(t.entryPrice)} で買い → {fmtDate(t.exitDate)} に {fmtJpy(t.exitPrice)} で売り
                  </div>
                  {t.exitReason && <div className="muted" style={{ fontSize: 12 }}>理由: {t.exitReason}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ③ AIへの方針 */}
      <div className="card" style={{ marginTop: 12 }}>
        <h3>AIへの方針（あなたの希望を伝える）</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          ここに書いた希望を、次の判断からAIが尊重します。ただし損切りなどの安全ルールは常に優先されます。
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {(['cautious', 'balanced', 'aggressive'] as Stance[]).map((v) => (
            <button
              key={v}
              className={stance === v ? '' : 'secondary'}
              onClick={() => setStance(v)}
              style={{ flex: 1 }}
            >
              {STANCE_LABEL[v]}
            </button>
          ))}
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例：決算前は買わないで / 利益が出たら早めに確定して / 今は様子見でいて"
          rows={3}
          style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'inherit', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button disabled={saving} onClick={saveGuidance}>{saving ? '保存中…' : 'AIに伝える'}</button>
        </div>

        {guidance && guidance.history.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>これまでに伝えたこと</div>
            {guidance.history.map((g) => (
              <div key={g.id} className="muted" style={{ fontSize: 12, padding: '3px 0' }}>
                {fmtDate(g.createdAt)} ・ {STANCE_LABEL[(g.stance as Stance) ?? 'balanced']}
                {g.text ? ` ・「${g.text}」` : ''}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
