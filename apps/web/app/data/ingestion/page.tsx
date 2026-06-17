'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';

interface IngestionRun {
  id: string;
  datasetName: string;
  status: string;
  recordCount: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  targetDate: string | null;
  fromDate: string | null;
  toDate: string | null;
  dataSource: { sourceType: string };
}

interface DatasetMap {
  jquants: string[];
  csv: string[];
  tdnet: string[];
  edinet: string[];
}

const STATUS_COLORS: Record<string, string> = {
  completed: '#28a745',
  running: '#007bff',
  failed: '#dc3545',
  pending: '#6c757d',
  skipped: '#ffc107',
};

export default function DataIngestionPage() {
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [datasets, setDatasets] = useState<DatasetMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [form, setForm] = useState({
    sourceType: 'jquants',
    datasetName: 'daily_prices',
    targetDate: new Date().toISOString().slice(0, 10),
    csvContent: '',
  });

  const load = () => {
    setLoading(true);
    Promise.all([
      api<IngestionRun[]>('/api/data-ingestion/runs?limit=50'),
      api<DatasetMap>('/api/data-ingestion/datasets'),
    ])
      .then(([r, d]) => {
        setRuns(r);
        setDatasets(d);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, []);

  async function triggerRun() {
    setMsg(null);
    try {
      if (form.sourceType === 'csv') {
        const result = await api<{ imported: number }>('/api/data-ingestion/csv-import', {
          method: 'POST',
          body: JSON.stringify({ datasetName: form.datasetName, csvContent: form.csvContent }),
        });
        setMsg(`CSV インポート完了: ${result.imported.toLocaleString()}件`);
      } else {
        await api('/api/data-ingestion/runs', {
          method: 'POST',
          body: JSON.stringify({
            sourceType: form.sourceType,
            datasetName: form.datasetName,
            targetDate: form.targetDate || undefined,
          }),
        });
        setMsg('ジョブを開始しました');
      }
      setTimeout(load, 2000);
    } catch (e) {
      setMsg(`エラー: ${String(e)}`);
    }
  }

  const availableDatasets =
    datasets && form.sourceType in datasets
      ? (datasets as Record<string, string[]>)[form.sourceType] ?? []
      : [];

  if (loading && runs.length === 0) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <p className="page-title">データ取得ジョブ</p>
      <p className="page-sub">市場データの取得・インポート状況を管理します</p>

      <div className="grid cols-2">
        <Card title="新規ジョブ実行">
          <div className="field">
            <label>データソース</label>
            <select value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value, datasetName: '' })}>
              <option value="jquants">J-Quants API</option>
              <option value="csv">CSV インポート</option>
              <option value="tdnet">TDnet</option>
              <option value="edinet">EDINET</option>
            </select>
          </div>

          <div className="field">
            <label>データセット</label>
            <select value={form.datasetName} onChange={(e) => setForm({ ...form, datasetName: e.target.value })}>
              {availableDatasets.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {form.sourceType !== 'csv' && (
            <div className="field">
              <label>対象日付</label>
              <input
                type="date"
                value={form.targetDate}
                onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
              />
            </div>
          )}

          {form.sourceType === 'csv' && (
            <div className="field">
              <label>CSV内容 (ヘッダー行含む)</label>
              <textarea
                rows={6}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                value={form.csvContent}
                onChange={(e) => setForm({ ...form, csvContent: e.target.value })}
                placeholder={form.datasetName === 'daily_prices' ? 'symbolCode,date,open,high,low,close,volume,turnoverValue\n7203,2024-01-04,2000,2050,1990,2030,1500000,3000000000' : 'CSVデータを貼り付け'}
              />
            </div>
          )}

          <button onClick={triggerRun} style={{ marginTop: 8 }}>
            {form.sourceType === 'csv' ? 'CSVインポート' : 'ジョブ実行'}
          </button>

          {msg && (
            <p style={{ marginTop: 8, fontSize: 13, color: msg.startsWith('エラー') ? '#dc3545' : '#155724' }}>
              {msg}
            </p>
          )}
        </Card>

        <Card title="取得可能データセット">
          {datasets && Object.entries(datasets).map(([src, ds]) => (
            <div key={src} style={{ marginBottom: 12 }}>
              <strong style={{ fontSize: 13 }}>{src}</strong>
              <ul style={{ margin: '4px 0', paddingLeft: 20, fontSize: 12, color: '#444' }}>
                {ds.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </div>
          ))}
        </Card>
      </div>

      <Card title={`実行履歴 (${runs.length}件)`} style={{ marginTop: 16 }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #dee2e6' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>ソース</th>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>データセット</th>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>対象日</th>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>ステータス</th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>件数</th>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>実行日時</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '4px 8px' }}>{run.dataSource.sourceType}</td>
                <td style={{ padding: '4px 8px' }}>{run.datasetName}</td>
                <td style={{ padding: '4px 8px', fontSize: 12, color: '#666' }}>
                  {run.targetDate ? run.targetDate.slice(0, 10) : '-'}
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <span style={{ color: STATUS_COLORS[run.status] ?? '#333', fontWeight: 500 }}>
                    {run.status}
                  </span>
                  {run.errorMessage && (
                    <span style={{ fontSize: 11, color: '#dc3545', display: 'block' }} title={run.errorMessage}>
                      {run.errorMessage.slice(0, 60)}
                    </span>
                  )}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                  {run.recordCount?.toLocaleString() ?? '-'}
                </td>
                <td style={{ padding: '4px 8px', fontSize: 12, color: '#666' }}>
                  {new Date(run.createdAt).toLocaleString('ja-JP')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.length === 0 && <p className="muted">まだジョブがありません</p>}
      </Card>
    </div>
  );
}
