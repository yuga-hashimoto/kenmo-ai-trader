'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, Badge } from '@/components/ui';

interface Log {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  payloadJson: unknown;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  useEffect(() => {
    api<Log[]>('/api/dashboard/audit-logs').then(setLogs).catch(() => setLogs([]));
  }, []);

  return (
    <div>
      <p className="page-title">監査ログ</p>
      <p className="page-sub">system / user / ai のすべての操作を記録</p>
      <Card>
        <table>
          <thead>
            <tr>
              <th>日時</th>
              <th>actor</th>
              <th>action</th>
              <th>target</th>
              <th>payload</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{new Date(l.createdAt).toLocaleString('ja-JP')}</td>
                <td>
                  <Badge kind={l.actor === 'ai' ? 'blue' : l.actor === 'user' ? 'green' : ''}>{l.actor}</Badge>
                </td>
                <td>{l.action}</td>
                <td className="muted">
                  {l.targetType}
                  {l.targetId ? `:${l.targetId.slice(0, 8)}` : ''}
                </td>
                <td className="muted">
                  <code>{l.payloadJson ? JSON.stringify(l.payloadJson).slice(0, 80) : ''}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
