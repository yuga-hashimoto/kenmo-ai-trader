'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDate, fmtPct } from '@/lib/api';
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

interface LeagueMember {
  paperRunId: string;
  strategyVersionId: string;
  strategyName: string;
  leagueRole: string;
  rank: number;
  trailingReturnPct: number | null;
  maxDrawdownPct: number | null;
  tradeCount: number;
  fitness: number | null;
  eligible: boolean;
  createdAt: string;
}
interface League {
  size: number;
  nextTournamentInDays: number;
  members: LeagueMember[];
}

export default function StrategiesPage() {
  const [rows, setRows] = useState<Strategy[]>([]);
  const [league, setLeague] = useState<League | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api<Strategy[]>('/api/strategies').then(setRows).catch(() => setRows([]));
    api<League>('/api/league').then(setLeague).catch(() => setLeague(null));
  };
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

  async function runTournament() {
    setBusy(true);
    try {
      await api('/api/league/tournament', { method: 'POST' });
      load();
    } finally {
      setBusy(false);
    }
  }

  const fitnessText = (m: LeagueMember) =>
    m.fitness === null ? '評価待ち' : m.fitness.toFixed(2);

  return (
    <div>
      <p className="page-title">戦略 (Champion / Challenger)</p>
      <p className="page-sub">
        Champion 1体とChallenger 5体が常に仮想取引で競争。約20営業日ごとに成績を評価し、優れたChallengerをChampionへ自動昇格、弱いChallengerは引退して現Championから新しいChallengerが生成されます。
      </p>

      {/* ---- リーグ（常時競争） ---- */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>🏆 リーグ表（仮想成績）</h3>
          <span className="muted" style={{ fontSize: 13 }}>
            {league ? `次回トーナメントまで 約${league.nextTournamentInDays}営業日` : ''}
          </span>
        </div>
        {!league ? (
          <p className="muted">読み込み中…</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>順位</th>
                  <th>役割</th>
                  <th>戦略</th>
                  <th>期間リターン</th>
                  <th>最大DD</th>
                  <th>取引</th>
                  <th>スコア(fitness)</th>
                  <th>世代</th>
                </tr>
              </thead>
              <tbody>
                {league.members.map((m) => (
                  <tr key={m.paperRunId}>
                    <td>{m.rank}</td>
                    <td>{m.leagueRole === 'champion' ? '👑 Champion' : 'Challenger'}</td>
                    <td>
                      <Link href={`/strategies/${m.strategyVersionId}`}>{m.strategyName}</Link>
                    </td>
                    <td className={m.trailingReturnPct != null && m.trailingReturnPct >= 0 ? 'pos' : 'neg'}>
                      {m.trailingReturnPct == null ? '—' : fmtPct(m.trailingReturnPct)}
                    </td>
                    <td className="muted">{m.maxDrawdownPct == null ? '—' : fmtPct(m.maxDrawdownPct)}</td>
                    <td>
                      {m.tradeCount}
                      {!m.eligible && <span className="muted" style={{ fontSize: 11 }}> (検証中)</span>}
                    </td>
                    <td>{fitnessText(m)}</td>
                    <td className="muted">{fmtDate(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              スコア = リスク調整リターン（期間リターン ÷ (最大DD+1)）。「検証中」は取引数が少なく評価対象外。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="secondary" disabled={busy} onClick={runTournament}>
                今すぐトーナメント実行
              </button>
            </div>
          </>
        )}
      </Card>

      {/* ---- 全戦略一覧 ---- */}
      <Card title="全戦略バージョン">
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
                  {s.status !== 'champion' && s.status !== 'archived' && (
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
