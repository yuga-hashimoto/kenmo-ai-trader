#!/usr/bin/env node
/**
 * Dump the outcome-joined decision journal to ./data so it can be read back by a
 * human or an assistant tuning the strategy. Pulls from the running API.
 *
 *   pnpm decision-journal                 # default horizons 5,10,20
 *   API=http://localhost:4000 pnpm decision-journal
 *
 * Writes: data/decision-journal.json (full rows), .csv (flat), .md (summary).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const API = process.env.API ?? 'http://localhost:4000';
const OUT = path.resolve('data');

const pct = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n}%`);

function toCsv(rows, horizons) {
  const head = [
    'date', 'decision', 'symbol', 'name', 'strategy', 'score', 'confidence',
    'buyAllowed', 'distanceTo52wHighPct', 'earningsQualityScore',
    ...horizons.map((h) => `ret${h}d`), 'reason',
  ];
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.date, r.decision, r.symbol, r.name, r.strategy, r.score, r.confidence,
      r.buyAllowed, r.distanceTo52wHighPct, r.earningsQualityScore,
      ...horizons.map((h) => r.forwardReturnPct[String(h)]), r.reason,
    ].map(esc).join(','),
  );
  return [head.join(','), ...lines].join('\n');
}

function aggLine(a) {
  return `n=${a.n}, 平均リターン ${pct(a.avgReturnPct)}, 勝率 ${a.positiveRatePct ?? '—'}%`;
}

function toMarkdown(j) {
  const { summary: s, params } = j;
  const lines = [];
  lines.push(`# 売買判断ジャーナル（答え合わせ込み）`);
  lines.push('');
  lines.push(`- 生成: ${j.generatedAt}`);
  lines.push(`- 判断件数: ${j.rowCount}（${Object.entries(s.byDecision).map(([k, v]) => `${k}:${v}`).join(' / ')}）`);
  lines.push(`- 勝敗の判定: 判断日の終値 → ${params.scoreHorizon}営業日後の終値。見送りは +${params.missThresholdPct}% 以上上昇で「取り逃し」。`);
  lines.push('');
  lines.push(`## 買い（実際に買った銘柄のその後）`);
  lines.push(`- 全体: ${aggLine(s.buys.total)}`);
  lines.push(`- スコア帯別:`);
  for (const [k, a] of Object.entries(s.buys.byScoreBucket)) lines.push(`  - ${k}: ${aggLine(a)}`);
  lines.push(`- 確信度別:`);
  for (const [k, a] of Object.entries(s.buys.byConfidenceBucket)) lines.push(`  - ${k}: ${aggLine(a)}`);
  lines.push(`- 戦略別:`);
  for (const [k, a] of Object.entries(s.buys.byStrategy)) lines.push(`  - ${k}: ${aggLine(a)}`);
  lines.push('');
  lines.push(`## 見送り（買わなかった理由ごとの「取り逃し」）`);
  lines.push(`- 全体: ${aggLine(s.skips.total)} ・ 取り逃し率 ${s.skips.missedWinnerRatePct ?? '—'}%`);
  lines.push(`- 理由別（平均リターンが高い＝止めたせいで上昇を逃した順）:`);
  lines.push('');
  lines.push(`| 見送り理由 | 件数 | 取り逃し | 平均リターン | 勝率 |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: |`);
  for (const r of s.skips.byReason) {
    lines.push(`| ${r.reason} | ${r.n} | ${r.missedWinners} | ${pct(r.avgReturnPct)} | ${r.positiveRatePct ?? '—'}% |`);
  }
  lines.push('');
  lines.push(`> 読み方: 「見送り理由」の平均リターンが大きくプラスなら、そのフィルターは勝てる銘柄を弾いている疑い。`);
  lines.push(`> 逆にマイナスなら、その見送りは正しく損を避けている。閾値調整の根拠に使う。`);
  return lines.join('\n');
}

async function main() {
  const res = await fetch(`${API}/api/analysis/decision-journal`);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const horizons = j.params.horizons;
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, 'decision-journal.json'), JSON.stringify(j, null, 2));
  await writeFile(path.join(OUT, 'decision-journal.csv'), toCsv(j.rows, horizons));
  await writeFile(path.join(OUT, 'decision-journal.md'), toMarkdown(j));
  console.log(`wrote ${j.rowCount} decisions → data/decision-journal.{json,csv,md}`);
  console.log(toMarkdown(j));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
