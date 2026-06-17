'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';

interface DataSourceStatus {
  sourceType: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastFetchCount: number | null;
  lastError: string | null;
  updatedAt: string | null;
  envStatus: Record<string, unknown>;
}

const SOURCE_LABELS: Record<string, string> = {
  jquants: 'J-Quants API (Paid/Optional)',
  yahoo_finance: 'Yahoo Finance (Node)',
  yfinance_python: 'Yahoo Finance (Python)',
  jpx: 'JPX 東証銘柄一覧',
  tdnet: 'TDnet (適時開示)',
  edinet: 'EDINET (有報)',
  kabu_station: 'kabuStation (板/価格)',
  csv: 'CSV インポート',
  seed: 'Seed (内蔵データ)',
};

const SOURCE_DESCRIPTIONS: Record<string, string> = {
  jquants: '銘柄マスター・日足・財務・配当・信用残・取引カレンダー等',
  yahoo_finance: 'yahoo-finance2を用いた日本株日足・配当・財務・決算スケジュールの取得',
  yfinance_python: 'Pythonのyfinanceを用いた日本株日足・配当・財務の取得(Node fallback)',
  jpx: '日本取引所グループ公式サイトの東証上場銘柄一覧Excelから銘柄をインポート',
  tdnet: '適時開示・決算短信・業績予想修正 (商用API)',
  edinet: '有価証券報告書・大量保有報告書 (API Key必要)',
  kabu_station: 'リアルタイム価格・板情報 (発注なし)',
  csv: 'CSVファイルから履歴データをインポート',
  seed: '開発用・デモ用の内蔵フィクスチャデータ',
};

function EnvBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 12,
        background: ok ? '#d4edda' : '#f8d7da',
        color: ok ? '#155724' : '#721c24',
        marginRight: 4,
      }}
    >
      {label}
    </span>
  );
}

function EnvStatusSection({ sourceType, envStatus }: { sourceType: string; envStatus: Record<string, unknown> }) {
  if (sourceType === 'jquants') {
    return (
      <div style={{ marginTop: 8 }}>
        <EnvBadge ok={!!envStatus.hasCredentials} label={envStatus.hasCredentials ? '認証情報あり' : '認証情報なし'} />
        <EnvBadge ok={true} label={`プラン: ${String(envStatus.plan ?? 'free')}`} />
        {Boolean(envStatus.addonsEnabled) && <EnvBadge ok={true} label="Add-on有効" />}
      </div>
    );
  }
  if (sourceType === 'yahoo_finance' || sourceType === 'yfinance_python') {
    const isPython = sourceType === 'yfinance_python';
    return (
      <div style={{ marginTop: 8 }}>
        <EnvBadge ok={envStatus.enabled as boolean} label={envStatus.enabled === false ? '無効' : '有効'} />
        {isPython ? (
          <EnvBadge ok={true} label={`Python Path: ${String(envStatus.pythonBin || 'python3')}`} />
        ) : (
          <>
            <EnvBadge ok={true} label={typeof envStatus.maxSymbols === 'number' ? `最大${(envStatus.maxSymbols as number).toLocaleString()}銘柄` : '全active銘柄'} />
            {Boolean(envStatus.hasConfiguredSymbols) && <EnvBadge ok={true} label="銘柄指定あり" />}
          </>
        )}
        <p style={{ fontSize: 11, color: '#c0392b', margin: '4px 0 0', fontWeight: 'bold', lineHeight: 1.4 }}>
          ⚠️ Yahoo Finance由来データは非公式・個人研究用途向けです。仕様変更や取得制限、利用条件に注意してください。商用利用・高頻度取得には使用しないでください。
        </p>
      </div>
    );
  }
  if (sourceType === 'jpx') {
    return (
      <div style={{ marginTop: 8 }}>
        <EnvBadge ok={true} label="有効 (常に利用可)" />
        <EnvBadge ok={true} label="東証公開Excelソース" />
      </div>
    );
  }
  if (sourceType === 'tdnet') {
    return (
      <div style={{ marginTop: 8 }}>
        <EnvBadge ok={!!envStatus.hasApiKey} label={envStatus.hasApiKey ? 'APIキーあり' : 'APIキーなし'} />
        <EnvBadge ok={envStatus.enabled as boolean} label={envStatus.enabled ? '有効' : '無効 (TDNET_ENABLED=false)'} />
      </div>
    );
  }
  if (sourceType === 'edinet') {
    return (
      <div style={{ marginTop: 8 }}>
        <EnvBadge ok={!!envStatus.hasApiKey} label={envStatus.hasApiKey ? 'APIキーあり' : 'APIキーなし'} />
        <EnvBadge ok={envStatus.enabled as boolean} label={envStatus.enabled ? '有効' : '無効 (EDINET_ENABLED=false)'} />
      </div>
    );
  }
  if (sourceType === 'kabu_station') {
    return (
      <div style={{ marginTop: 8 }}>
        <EnvBadge ok={!!envStatus.hasPassword} label={envStatus.hasPassword ? 'パスワードあり' : 'パスワードなし'} />
        <EnvBadge ok={envStatus.enabled as boolean} label={envStatus.enabled ? '有効' : '無効 (KABU_STATION_ENABLED=false)'} />
        <p style={{ fontSize: 11, color: '#666', margin: '4px 0 0' }}>⚠️ 発注APIは接続しません (板/価格照会のみ)</p>
      </div>
    );
  }
  if (sourceType === 'csv' || sourceType === 'seed') {
    return (
      <div style={{ marginTop: 8 }}>
        <EnvBadge ok={true} label="常時利用可" />
      </div>
    );
  }
  return null;
}

export default function DataSourcesPage() {
  const [sources, setSources] = useState<DataSourceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api<DataSourceStatus[]>('/api/data-sources')
      .then(setSources)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  async function toggle(sourceType: string, enabled: boolean) {
    setMsg(null);
    try {
      await api(`/api/data-sources/${sourceType}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      setMsg(`${SOURCE_LABELS[sourceType] ?? sourceType}: ${enabled ? '有効化' : '無効化'}しました`);
      load();
    } catch (e) {
      setMsg(`エラー: ${String(e)}`);
    }
  }

  if (loading) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <p className="page-title">データソース設定</p>
      <p className="page-sub">各データプロバイダーの有効/無効・認証状態・最終取得状況</p>

      <div className="warn" style={{ marginBottom: 16 }}>
        ⚠️ APIキーは <code>.env</code> ファイルで設定してください。設定されていない場合は Seed/CSV にフォールバックします。
        本番売買APIには接続しません。
      </div>

      {msg && <p style={{ marginBottom: 12, color: '#155724', background: '#d4edda', padding: '8px 12px', borderRadius: 4 }}>{msg}</p>}

      <div className="grid cols-2">
        {sources.map((src) => (
          <Card key={src.sourceType} title={SOURCE_LABELS[src.sourceType] ?? src.sourceType}>
            <p className="muted" style={{ marginBottom: 8 }}>{SOURCE_DESCRIPTIONS[src.sourceType]}</p>

            <EnvStatusSection sourceType={src.sourceType} envStatus={src.envStatus} />

            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 13 }}>DBで有効化:</label>
              <select
                value={src.enabled ? 'on' : 'off'}
                onChange={(e) => toggle(src.sourceType, e.target.value === 'on')}
                style={{ padding: '2px 8px' }}
              >
                <option value="off">OFF</option>
                <option value="on">ON</option>
              </select>
            </div>

            {src.lastFetchedAt && (
              <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
                最終取得: {new Date(src.lastFetchedAt).toLocaleString('ja-JP')}
                {src.lastFetchCount != null && ` (${src.lastFetchCount.toLocaleString()}件)`}
              </p>
            )}

            {src.lastError && (
              <p style={{ fontSize: 12, color: '#dc3545', marginTop: 4, wordBreak: 'break-word' }}>
                エラー: {src.lastError}
              </p>
            )}
          </Card>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <a href="/data/ingestion" style={{ color: '#0066cc' }}>→ データ取得ジョブ管理</a>
      </div>
    </div>
  );
}
