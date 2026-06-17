import './globals.css';
import type { ReactNode } from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'kenmo-ai-trader',
  description: 'HermesAgent autonomous mid/small-cap growth trading — backtest & paper',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="layout">
          <aside className="sidebar">
            <h1>kenmo-ai-trader</h1>
            <div className="tag">HermesAgent · backtest/paper</div>
            <nav className="nav">
              <Link href="/">ダッシュボード</Link>
              <Link href="/backtests">バックテスト</Link>
              <Link href="/paper">Paper運用</Link>
              <Link href="/strategies">戦略 (Champion/Challenger)</Link>
              <Link href="/settings">設定</Link>
              <Link href="/audit">監査ログ</Link>
              <div style={{ marginTop: 8, fontSize: 11, color: '#888', fontWeight: 600, letterSpacing: '0.05em' }}>DATA</div>
              <Link href="/data/ingestion">データ取得ジョブ</Link>
              <Link href="/data/bootstrap">無料一括データ構築</Link>
              <Link href="/data/symbols">銘柄マスター</Link>
              <Link href="/data/quality">データ品質</Link>
              <Link href="/settings/data-sources">データソース設定</Link>
            </nav>
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
