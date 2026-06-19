'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtJpy, fmtDate } from '@/lib/api';
import { SymbolLink } from '@/components/ui';

/** One AI decision for a single symbol on a given session. */
interface Decision {
  symbol: string;
  decision: 'buy' | 'sell' | 'skip' | 'hold' | string;
  reason: string;
  thesis: string;
  strategy: string;
  confidence: number | null;
  budgetJpy: number | null;
  limitPrice: number | null;
  sellPositionPct: number | null;
  doNotBuyReasons: string[];
  riskFactors: string[];
  expectedHoldingDays: number | null;
}
interface Candidate {
  symbol: string;
  name: string;
  close: number;
}
interface AgentRun {
  id: string;
  createdAt: string;
  inputJson: { candidates?: Candidate[] } | null;
  outputJson: { notes?: string; decisions?: Decision[] } | null;
}
interface Order {
  symbolCode: string;
  side: 'buy' | 'sell';
  finalQuantity: number | null;
  limitPrice: number | null;
  status: string;
  executionPrice: number | null;
  executedQuantity: number | null;
  rejectionReason: string | null;
}
interface Run {
  id: string;
  status: string;
  leagueRole?: string | null;
}
interface SchedulerStatus {
  lastEvent: { date: string; time: string; eventType: string } | null;
}

const STRATEGY_LABEL: Record<string, string> = {
  new_high_breakout: '高値ブレイク',
  roe_growth: 'ROE成長',
  earnings_momentum: '決算モメンタム',
};

const strategyLabel = (s: string): string => STRATEGY_LABEL[s] ?? s;

/** Soften backend jargon so a non-technical reader can follow the reasoning. */
function humanizeReason(text: string): string {
  return text
    .replace(/地合い\s*risk[_ ]?off\s*で新規買い停止/gi, '相場全体が弱いため、新規の買いを止めています')
    .replace(/地合い\s*risk[_ ]?off/gi, '相場全体が弱い局面')
    .replace(/地合い\s*risk[_ ]?on/gi, '相場全体が強い局面')
    .replace(/risk[_ ]?off/gi, '弱気')
    .replace(/risk[_ ]?on/gi, '強気')
    .replace(/地合い/g, '相場全体');
}

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

export default function Today() {
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sched, setSched] = useState<SchedulerStatus | null>(null);
  const [hasRun, setHasRun] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const runs = await api<Run[]>('/api/paper-runs');
      const active =
        runs.find((r) => r.leagueRole === 'champion' && r.status === 'running') ??
        runs.find((r) => r.status === 'running') ??
        runs[0] ??
        null;
      if (!active) {
        setHasRun(false);
        return;
      }
      const [ars, ords, status] = await Promise.all([
        api<AgentRun[]>(`/api/paper-runs/${active.id}/agent-runs`).catch(() => [] as AgentRun[]),
        api<Order[]>(`/api/paper-runs/${active.id}/orders`).catch(() => [] as Order[]),
        api<SchedulerStatus>('/api/scheduler/status').catch(() => null),
      ]);
      setAgentRun(ars.at(-1) ?? null);
      setOrders(ords);
      setSched(status);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (!loaded) return <p className="muted">読み込み中…</p>;

  if (!hasRun) {
    return (
      <div>
        <p className="page-title">今日の結果</p>
        <div className="card" style={{ marginTop: 12 }}>
          <p>まだ運用が始まっていません。</p>
          <p className="muted">
            <Link href="/paper">Paper運用</Link> から「ライブ開始」で、AIの自動売買がスタートします。
          </p>
        </div>
      </div>
    );
  }

  const decisions = agentRun?.outputJson?.decisions ?? [];
  const nameBySymbol = new Map(
    (agentRun?.inputJson?.candidates ?? []).map((c) => [c.symbol, c.name]),
  );
  const orderBySymbol = new Map(orders.map((o) => [o.symbolCode, o]));

  const buys = decisions.filter((d) => d.decision === 'buy');
  const sells = decisions.filter((d) => d.decision === 'sell');
  const skips = decisions.filter((d) => d.decision === 'skip' || d.decision === 'hold');
  const acted = [...buys, ...sells];

  // When the AI ran but bought/sold nothing, that itself is a decision — make it
  // explicit so a quiet day reads as "AI chose to wait", not "nothing happened".
  const wasQuiet = acted.length === 0 && decisions.length > 0;

  const ranAt = sched?.lastEvent;
  const name = (sym: string) => nameBySymbol.get(sym) ?? sym;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <p className="page-title" style={{ marginBottom: 4 }}>今日の結果</p>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        AIは毎営業日の引け後（15:40）に動きます。これは練習（Paper）で、本物のお金は使っていません。
      </p>

      {/* いつ動いたか */}
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span>
            <b>AIが最後に動いた日</b>
          </span>
          <span className="muted" style={{ fontSize: 13 }}>
            {agentRun ? relativeTime(agentRun.createdAt) : '—'}
          </span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
          {ranAt ? `${ranAt.date} ${ranAt.time}` : agentRun ? fmtDate(agentRun.createdAt) : '—'}
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          この日、AIは <b>{decisions.length}</b> 銘柄を検討して、
          買い <b>{buys.length}</b>件 ・ 売り <b>{sells.length}</b>件 ・ 見送り <b>{skips.length}</b>件 を判断しました。
        </div>
      </div>

      {/* 何もしなかった日の安心メッセージ */}
      {wasQuiet && (
        <div className="card" style={{ marginTop: 12, borderLeft: '4px solid var(--border)' }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>🛡️ 今日は「買わずに様子見」を選びました</div>
          <p className="muted" style={{ fontSize: 13, marginTop: 6, marginBottom: 0 }}>
            候補はあったものの、AIは条件が整っていないと判断し、あえて何も買いませんでした。
            無理に売買しないのも大事な判断です。理由は下のとおりです。
          </p>
        </div>
      )}

      {/* 実際に売買したこと */}
      {acted.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>AIが実際に動いたこと</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {acted.map((d) => {
              const ord = orderBySymbol.get(d.symbol);
              const isBuy = d.decision === 'buy';
              const filled = ord?.status === 'filled';
              const price = ord?.executionPrice ?? ord?.limitPrice ?? d.limitPrice;
              const qty = ord?.executedQuantity ?? ord?.finalQuantity;
              return (
                <div key={d.symbol} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 600 }}>
                      <span className={isBuy ? 'pos' : 'neg'}>{isBuy ? '買い' : '売り'}</span>{' '}
                      {name(d.symbol)} <span className="muted"><SymbolLink code={d.symbol} /></span>
                    </span>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {filled ? '約定' : ord?.status === 'rejected' ? '不成立' : '発注'}
                      {qty != null ? ` ・ ${qty}株` : ''}
                      {price != null ? ` ・ ${fmtJpy(price)}` : ''}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    {strategyLabel(d.strategy)}
                    {d.confidence != null ? ` ・ 確信度 ${Math.round(d.confidence * 100)}%` : ''}
                  </div>
                  {(d.thesis || d.reason) && (
                    <div style={{ fontSize: 13, marginTop: 4 }}>理由: {humanizeReason(d.thesis || d.reason)}</div>
                  )}
                  {ord?.rejectionReason && (
                    <div className="neg" style={{ fontSize: 12, marginTop: 2 }}>不成立: {ord.rejectionReason}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 見送り(買わなかった理由) */}
      {skips.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>見送った銘柄と理由</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            AIが「今は買わない」と判断した銘柄です。
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {skips.map((d) => {
              const rawMain = d.reason?.replace(/^見送り[:：]\s*/, '') || '条件が整わず見送り';
              const mainReason = humanizeReason(rawMain);
              // Drop the headline reason from the detail list so it isn't shown twice.
              const extraReasons = d.doNotBuyReasons
                .filter((r) => r !== rawMain)
                .map(humanizeReason);
              return (
                <div key={d.symbol} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span>
                      <b>{name(d.symbol)}</b> <span className="muted"><SymbolLink code={d.symbol} /></span>
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>{strategyLabel(d.strategy)}</span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 3 }}>{mainReason}</div>
                  {extraReasons.length > 0 && (
                    <ul className="muted" style={{ fontSize: 12, margin: '4px 0 0', paddingLeft: 18 }}>
                      {extraReasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {decisions.length === 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <p className="muted">まだ今日の判断データがありません。引け後（15:40）の処理が終わると表示されます。</p>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Link href="/" className="muted">← ダッシュボードに戻る</Link>
      </div>
    </div>
  );
}
