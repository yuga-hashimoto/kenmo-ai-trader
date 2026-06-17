'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';

interface QualityIssue {
  severity: 'error' | 'warning' | 'info';
  checkName: string;
  symbolCode?: string;
  date?: string;
  message: string;
  details?: Record<string, unknown>;
}

interface QualityReport {
  checkedAt: string;
  totalIssues: number;
  errors: number;
  warnings: number;
  issues: QualityIssue[];
}

interface QualitySummary {
  symbolCount: number;
  activeSymbols: number;
  inactiveSymbols: number;
  priceCount: number;
  financialCount: number;
  disclosureCount: number;
  indexPriceCount: number;
  ingestRunCount: number;
  priceRange: { from: string | null; to: string | null };
  lastIngestion: string | null;
}

const SEVERITY_COLORS = {
  error: '#dc3545',
  warning: '#ffc107',
  info: '#17a2b8',
};

const SEVERITY_LABELS = {
  error: 'エラー',
  warning: '警告',
  info: '情報',
};

const CHECK_LABELS: Record<string, string> = {
  orphaned_prices: '銘柄マスター外の価格データ',
  missing_trading_days: '価格欠損営業日',
  zero_volume_anomaly: '出来高ゼロ異常',
  possible_unadjusted_split: '株式分割未調整疑い',
  future_financial_leak: '未来情報混入',
  delisted_symbol_in_backtest: '廃止銘柄混入',
  financial_date_no_price: '決算日に価格なし',
  duplicate_disclosure: '重複開示',
};

export default function DataQualityPage() {
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [checkFilter, setCheckFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState({ from: '2020-01-01', to: new Date().toISOString().slice(0, 10) });

  useEffect(() => {
    api<QualitySummary>('/api/data-quality/summary')
      .then(setSummary)
      .finally(() => setLoading(false));
  }, []);

  async function runCheck() {
    setChecking(true);
    try {
      const r = await api<QualityReport>(
        `/api/data-quality/check?from=${dateRange.from}&to=${dateRange.to}`,
      );
      setReport(r);
    } finally {
      setChecking(false);
    }
  }

  const filteredIssues = report?.issues.filter((i) => {
    if (severityFilter !== 'all' && i.severity !== severityFilter) return false;
    if (checkFilter !== 'all' && i.checkName !== checkFilter) return false;
    return true;
  }) ?? [];

  const checkNames = report ? [...new Set(report.issues.map((i) => i.checkName))] : [];

  if (loading) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <p className="page-title">データ品質チェック</p>
      <p className="page-sub">欠損・異常・未来情報混入・廃止銘柄などを検出します</p>

      {summary && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: '銘柄数', value: summary.symbolCount },
            { label: '価格レコード', value: summary.priceCount },
            { label: '決算データ', value: summary.financialCount },
            { label: '開示データ', value: summary.disclosureCount },
            { label: '指数価格', value: summary.indexPriceCount },
            { label: '取得ジョブ', value: summary.ingestRunCount },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: '#f8f9fa', padding: '8px 16px', borderRadius: 6, minWidth: 100 }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{value.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {summary?.priceRange.from && (
        <p className="muted" style={{ marginBottom: 16 }}>
          価格データ期間: {summary.priceRange.from?.slice(0, 10)} 〜 {summary.priceRange.to?.slice(0, 10)}
          {summary.lastIngestion && ` / 最終取得: ${new Date(summary.lastIngestion).toLocaleString('ja-JP')}`}
        </p>
      )}

      <div style={{ marginBottom: 16 }}>
        <Card title="品質チェック実行">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0 }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>開始日</label>
              <input type="date" value={dateRange.from} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>終了日</label>
              <input type="date" value={dateRange.to} onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })} />
            </div>
            <button onClick={runCheck} disabled={checking}>
              {checking ? 'チェック中…' : 'チェック実行'}
            </button>
          </div>
        </Card>
      </div>

      {report && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ background: '#f8d7da', padding: '8px 16px', borderRadius: 6 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#721c24' }}>{report.errors}</div>
              <div style={{ fontSize: 12, color: '#721c24' }}>エラー</div>
            </div>
            <div style={{ background: '#fff3cd', padding: '8px 16px', borderRadius: 6 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#856404' }}>{report.warnings}</div>
              <div style={{ fontSize: 12, color: '#856404' }}>警告</div>
            </div>
            <div style={{ background: '#d1ecf1', padding: '8px 16px', borderRadius: 6 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0c5460' }}>
                {report.totalIssues - report.errors - report.warnings}
              </div>
              <div style={{ fontSize: 12, color: '#0c5460' }}>情報</div>
            </div>
          </div>

          <Card title={`問題一覧 (${filteredIssues.length}/${report.totalIssues}件)`}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
                <option value="all">全て</option>
                <option value="error">エラーのみ</option>
                <option value="warning">警告のみ</option>
                <option value="info">情報のみ</option>
              </select>
              <select value={checkFilter} onChange={(e) => setCheckFilter(e.target.value)}>
                <option value="all">全チェック</option>
                {checkNames.map((c) => (
                  <option key={c} value={c}>{CHECK_LABELS[c] ?? c}</option>
                ))}
              </select>
            </div>

            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
              {filteredIssues.length === 0 ? (
                <p className="muted">問題は検出されませんでした</p>
              ) : (
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #dee2e6', position: 'sticky', top: 0, background: '#fff' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px', width: 60 }}>種別</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', width: 160 }}>チェック</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', width: 80 }}>銘柄</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', width: 90 }}>日付</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>メッセージ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIssues.slice(0, 200).map((issue, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '3px 8px' }}>
                          <span style={{
                            fontSize: 11,
                            padding: '1px 5px',
                            borderRadius: 3,
                            background: issue.severity === 'error' ? '#f8d7da' : issue.severity === 'warning' ? '#fff3cd' : '#d1ecf1',
                            color: SEVERITY_COLORS[issue.severity],
                          }}>
                            {SEVERITY_LABELS[issue.severity]}
                          </span>
                        </td>
                        <td style={{ padding: '3px 8px', fontSize: 12, color: '#666' }}>
                          {CHECK_LABELS[issue.checkName] ?? issue.checkName}
                        </td>
                        <td style={{ padding: '3px 8px', fontFamily: 'monospace', fontSize: 12 }}>
                          {issue.symbolCode ?? '-'}
                        </td>
                        <td style={{ padding: '3px 8px', fontSize: 12, color: '#666' }}>
                          {issue.date ?? '-'}
                        </td>
                        <td style={{ padding: '3px 8px' }}>{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
              チェック実施: {new Date(report.checkedAt).toLocaleString('ja-JP')}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
