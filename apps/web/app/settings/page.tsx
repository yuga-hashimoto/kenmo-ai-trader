'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';

interface Settings {
  id: string;
  initialCapitalJpy: number;
  allowMargin: boolean;
  tradingMode: string;
  liveTradingEnabled: boolean;
  liveTradingPossible: boolean;
  hermesMode: string;
  riskDefaults: Record<string, number | boolean>;
  universeDefaults: Record<string, number>;
}

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api<Settings>('/api/settings').then(setS);
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!s) return;
    setMsg(null);
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          initialCapitalJpy: s.initialCapitalJpy,
          allowMargin: s.allowMargin,
          tradingMode: s.tradingMode,
        }),
      });
      setMsg('保存しました');
      load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  if (!s) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <p className="page-title">設定</p>
      <p className="page-sub">デフォルト値・HermesAgent接続・Trading Mode・リスク設定</p>

      <div className="warn" style={{ marginBottom: 16 }}>
        ⚠️ Live（本番発注）は既定で無効です。LiveBrokerAdapterは安全stubで、ENABLE_LIVE_TRADING=true かつ
        確認フローを経ない限り発注できません。現在: {s.liveTradingPossible ? 'env許可あり' : 'env未許可（安全）'}。
      </div>

      <div className="grid cols-2">
        <Card title="基本設定">
          <div className="field">
            <label>デフォルト元本 (JPY)</label>
            <input
              type="number"
              value={s.initialCapitalJpy}
              onChange={(e) => setS({ ...s, initialCapitalJpy: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>デフォルト信用取引</label>
            <select
              value={s.allowMargin ? 'on' : 'off'}
              onChange={(e) => setS({ ...s, allowMargin: e.target.value === 'on' })}
            >
              <option value="off">OFF</option>
              <option value="on">ON</option>
            </select>
          </div>
          <div className="field">
            <label>Trading Mode</label>
            <select value={s.tradingMode} onChange={(e) => setS({ ...s, tradingMode: e.target.value })}>
              <option value="backtest">backtest</option>
              <option value="paper">paper</option>
              <option value="live" disabled={!s.liveTradingPossible}>
                live {s.liveTradingPossible ? '' : '(無効)'}
              </option>
            </select>
          </div>
          <button onClick={save}>保存</button>
          {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}
        </Card>

        <Card title="HermesAgent 接続">
          <p>モード: <strong>{s.hermesMode}</strong></p>
          <p className="muted">
            mock = ルールベースAI（既定）。remote = OpenHermesAgentClient（HERMES_AGENT_ENDPOINT /
            HERMES_AGENT_API_KEY / HERMES_AGENT_MODEL を設定。未設定時はmockへfallback）。
          </p>
        </Card>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="リスク設定 (default)">
          <pre>{JSON.stringify(s.riskDefaults, null, 2)}</pre>
        </Card>
        <Card title="ユニバース設定 (default)">
          <pre>{JSON.stringify(s.universeDefaults, null, 2)}</pre>
        </Card>
      </div>
    </div>
  );
}
