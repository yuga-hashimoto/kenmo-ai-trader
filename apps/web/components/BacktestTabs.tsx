import Link from 'next/link';

export function BacktestTabs({ id, active }: { id: string; active: string }) {
  const tabs = [
    { key: 'summary', label: 'サマリー', href: `/backtests/${id}` },
    { key: 'trades', label: '売買履歴', href: `/backtests/${id}/trades` },
    { key: 'advanced-filters', label: '高度フィルター', href: `/backtests/${id}/advanced-filters` },
    { key: 'loss-analysis', label: '負け分析', href: `/backtests/${id}/loss-analysis` },
    { key: 'ablation', label: 'Ablation', href: `/backtests/${id}/ablation` },
    { key: 'agent-runs', label: 'AI判断ログ', href: `/backtests/${id}/agent-runs` },
    { key: 'scheduler-events', label: 'スケジューラ', href: `/backtests/${id}/scheduler-events` },
    { key: 'evolution', label: 'AI改善/Challenger', href: `/backtests/${id}/evolution` },
  ];
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          style={active === t.key ? { background: 'var(--panel-2)', borderColor: 'var(--accent)' } : undefined}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
