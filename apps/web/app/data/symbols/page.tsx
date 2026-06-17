'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';

interface Symbol {
  id: string;
  code: string;
  name: string;
  market: string;
  sector: string;
  marketCapJpy: number | null;
  lotSize: number;
  isActive: boolean;
}

export default function DataSymbolsPage() {
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('active');

  useEffect(() => {
    api<Symbol[]>('/api/symbols')
      .then(setSymbols)
      .finally(() => setLoading(false));
  }, []);

  const markets = [...new Set(symbols.map((s) => s.market))].sort();

  const filtered = symbols.filter((s) => {
    if (activeFilter === 'active' && !s.isActive) return false;
    if (activeFilter === 'inactive' && s.isActive) return false;
    if (marketFilter && s.market !== marketFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
    }
    return true;
  });

  const activeCount = symbols.filter((s) => s.isActive).length;
  const inactiveCount = symbols.filter((s) => !s.isActive).length;

  if (loading) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <p className="page-title">銘柄マスター</p>
      <p className="page-sub">登録銘柄一覧・上場廃止銘柄の確認</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ background: '#e8f5e9', padding: '8px 16px', borderRadius: 6 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#2e7d32' }}>{activeCount.toLocaleString()}</div>
          <div style={{ fontSize: 12, color: '#555' }}>上場中</div>
        </div>
        <div style={{ background: '#fce4ec', padding: '8px 16px', borderRadius: 6 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#c62828' }}>{inactiveCount.toLocaleString()}</div>
          <div style={{ fontSize: 12, color: '#555' }}>廃止・非アクティブ</div>
        </div>
        <div style={{ background: '#e3f2fd', padding: '8px 16px', borderRadius: 6 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#1565c0' }}>{symbols.length.toLocaleString()}</div>
          <div style={{ fontSize: 12, color: '#555' }}>合計</div>
        </div>
      </div>

      <Card title="フィルター" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="コード・銘柄名で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: '4px 8px', minWidth: 200 }}
          />
          <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as 'all' | 'active' | 'inactive')}>
            <option value="all">全て</option>
            <option value="active">上場中のみ</option>
            <option value="inactive">廃止のみ</option>
          </select>
          <select value={marketFilter} onChange={(e) => setMarketFilter(e.target.value)}>
            <option value="">全市場</option>
            {markets.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="muted" style={{ fontSize: 13 }}>{filtered.length.toLocaleString()}件表示</span>
        </div>
      </Card>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #dee2e6', background: '#f8f9fa' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>コード</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>銘柄名</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>市場</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>セクター</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>時価総額 (百万円)</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>単元株</th>
              <th style={{ textAlign: 'center', padding: '6px 8px' }}>状態</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{s.code}</td>
                <td style={{ padding: '4px 8px' }}>{s.name}</td>
                <td style={{ padding: '4px 8px', fontSize: 12, color: '#666' }}>{s.market}</td>
                <td style={{ padding: '4px 8px', fontSize: 12, color: '#666' }}>{s.sector}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {s.marketCapJpy != null ? (s.marketCapJpy / 1_000_000).toFixed(0) : '-'}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {s.lotSize.toLocaleString()}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                  <span style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: s.isActive ? '#d4edda' : '#f8d7da',
                    color: s.isActive ? '#155724' : '#721c24',
                  }}>
                    {s.isActive ? '上場中' : '廃止'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <p className="muted" style={{ textAlign: 'center', marginTop: 8 }}>
            {filtered.length.toLocaleString()}件中500件表示。検索条件を絞り込んでください。
          </p>
        )}
      </div>
    </div>
  );
}
