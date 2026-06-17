'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';

interface BootstrapConfig {
  marketFilter: string;
  maxSymbols: number;
  fromDate: string;
  toDate: string;
}

export default function DataBootstrapPage() {
  const [form, setForm] = useState<BootstrapConfig>({
    marketFilter: 'Prime',
    maxSymbols: 50,
    fromDate: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10), // 30 days ago
    toDate: new Date().toISOString().slice(0, 10),
  });

  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRecentRuns = () => {
    api<any[]>('/api/data-ingestion/runs?limit=10')
      .then((runs) => {
        setRecentRuns(runs.filter(r => r.datasetName === 'bootstrap_free' || r.dataSource?.sourceType === 'jpx'));
        const running = runs.some((r) => r.status === 'running');
        setIsRunning(running);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRecentRuns();
    const interval = setInterval(loadRecentRuns, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleBootstrap = async () => {
    setStatusMessage(null);
    setIsRunning(true);
    try {
      await api('/api/data-bootstrap/free', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setStatusMessage('無料データ初期セットアップジョブを開始しました（バックグラウンド実行中）');
      loadRecentRuns();
    } catch (e) {
      setStatusMessage(`エラーが発生しました: ${String(e)}`);
      setIsRunning(false);
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{
        background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
        padding: '32px',
        borderRadius: '16px',
        color: '#ffffff',
        marginBottom: '24px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
      }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 8px 0', letterSpacing: '-0.025em' }}>
          無料データ・ブートストラップ
        </h1>
        <p style={{ fontSize: '15px', opacity: 0.9, margin: 0, lineHeight: 1.5 }}>
          J-Quantsの有料枠を使わずに、JPXの公開銘柄マスタおよびYahoo Financeデータを用いて、
          ローカル環境にバックテスト用の検証用データを一括で初期構築します。
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        <Card title="セットアップ構成">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '6px', color: '#374151' }}>
                対象市場区分
              </label>
              <select
                value={form.marketFilter}
                onChange={(e) => setForm({ ...form, marketFilter: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#fff', fontSize: '14px' }}
              >
                <option value="Prime">プライム (Prime)</option>
                <option value="Standard">スタンダード (Standard)</option>
                <option value="Growth">グロース (Growth)</option>
                <option value="">すべての上場銘柄</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '6px', color: '#374151' }}>
                最大インポート銘柄数 (過剰リクエスト防止用)
              </label>
              <input
                type="number"
                value={form.maxSymbols}
                onChange={(e) => setForm({ ...form, maxSymbols: Number(e.target.value) })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px' }}
                min={1}
                max={500}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '6px', color: '#374151' }}>
                  開始日付 (From)
                </label>
                <input
                  type="date"
                  value={form.fromDate}
                  onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '6px', color: '#374151' }}>
                  終了日付 (To)
                </label>
                <input
                  type="date"
                  value={form.toDate}
                  onChange={(e) => setForm({ ...form, toDate: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px' }}
                />
              </div>
            </div>

            <div style={{
              backgroundColor: '#fef3c7',
              border: '1px solid #fcd34d',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '12px',
              color: '#92400e',
              lineHeight: 1.5
            }}>
              ⚠️ 実行にはJPX Excelのダウンロードと各銘柄への並行APIリクエストが行われます。
              過度な同時リクエストを防ぐため、1〜2秒ずつの待機時間を挟みながら処理が進みます。大量の銘柄を指定した場合は完了まで時間がかかります。
            </div>

            <button
              onClick={handleBootstrap}
              disabled={isRunning}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                fontWeight: '600',
                fontSize: '15px',
                border: 'none',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                background: isRunning ? '#cbd5e1' : 'linear-gradient(to right, #4f46e5, #7c3aed)',
                color: '#ffffff',
                boxShadow: isRunning ? 'none' : '0 4px 6px -1px rgba(79, 70, 229, 0.4)',
                transition: 'all 0.2s ease',
              }}
            >
              {isRunning ? 'セットアップ実行中...' : '無料データ一括初期構築を開始'}
            </button>

            {statusMessage && (
              <div style={{
                padding: '12px',
                borderRadius: '8px',
                fontSize: '13px',
                backgroundColor: statusMessage.startsWith('エラー') ? '#fee2e2' : '#ecfdf5',
                color: statusMessage.startsWith('エラー') ? '#b91c1c' : '#047857',
                border: `1px solid ${statusMessage.startsWith('エラー') ? '#fca5a5' : '#a7f3d0'}`
              }}>
                {statusMessage}
              </div>
            )}
          </div>
        </Card>

        <Card title="進捗・構築履歴">
          {loading ? (
            <p>読み込み中...</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recentRuns.length === 0 ? (
                <p style={{ color: '#6b7280', fontSize: '13px', margin: 0 }}>過去のブートストラップ実行履歴はありません。</p>
              ) : (
                recentRuns.map((run) => (
                  <div key={run.id} style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    padding: '12px',
                    fontSize: '13px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    position: 'relative'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: '600', color: '#111827' }}>
                        {run.datasetName === 'bootstrap_free' ? '無料一括構築' : '銘柄マスター同期'}
                      </span>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        backgroundColor: run.status === 'completed' ? '#d1fae5' : run.status === 'running' ? '#dbeafe' : '#fee2e2',
                        color: run.status === 'completed' ? '#065f46' : run.status === 'running' ? '#1e40af' : '#991b1b',
                      }}>
                        {run.status.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ color: '#4b5563', fontSize: '12px' }}>
                      取得件数: {run.recordCount != null ? `${run.recordCount.toLocaleString()} 件` : '-'}
                    </div>
                    {run.errorMessage && (
                      <div style={{ color: '#dc2626', fontSize: '11px', marginTop: '4px', overflowWrap: 'anywhere' }}>
                        エラー: {run.errorMessage}
                      </div>
                    )}
                    <div style={{ color: '#9ca3af', fontSize: '11px', marginTop: '2px' }}>
                      {new Date(run.createdAt).toLocaleString('ja-JP')}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
