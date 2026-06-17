'use client';

import { use, useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { statusBadge } from '@/components/ui';
import { BacktestTabs } from '@/components/BacktestTabs';

interface Event {
  id: string;
  eventDate: string;
  virtualTime: string | null;
  eventType: string;
  status: string;
  agentRunId: string | null;
}

export default function SchedulerEventsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [events, setEvents] = useState<Event[]>([]);
  useEffect(() => {
    api<Event[]>(`/api/backtests/${id}/scheduler-events`).then(setEvents).catch(() => setEvents([]));
  }, [id]);

  return (
    <div>
      <p className="page-title">仮想スケジューラ イベントログ</p>
      <BacktestTabs id={id} active="scheduler-events" />
      <p className="page-sub">
        VirtualClockが時系列で発火したイベント（{events.length} 件）。各日 08:30 prepare_watchlist →
        09:05/10:30/12:35/14:30 monitor_and_trade → 15:20 pre_close_review → 15:40 after_close_analysis
      </p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th>仮想時刻</th>
              <th>イベント</th>
              <th>状態</th>
              <th>AgentRun</th>
            </tr>
          </thead>
          <tbody>
            {events.slice(0, 500).map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.eventDate)}</td>
                <td>{e.virtualTime}</td>
                <td>{e.eventType}</td>
                <td>{statusBadge(e.status)}</td>
                <td className="muted">{e.agentRunId ? e.agentRunId.slice(0, 10) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length > 500 && <p className="muted">最初の500件を表示しています。</p>}
      </div>
    </div>
  );
}
