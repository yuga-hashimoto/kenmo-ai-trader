# kenmo-ai-trader — 初回実装プロンプト（改訂版 v2）

あなたはシニアフルスタックエンジニア兼自動売買システムアーキテクトです。
kenmo氏の中小型成長株投資法をベースに、HermesAgent が日本株を対象に自動で銘柄分析・売買判断・
バックテスト・Paper運用・戦略改善・ブラウザ可視化を行う**本格的なAI投資システム（完成形）**を実装してください。

これはMVPではありません。動く最小版で終わらせないでください。最初から本番運用を見据えた完成形の
アーキテクチャ・DB・UI・バックテスト・Paper運用・AI改善・BrokerAdapter・安全装置・監査ログ・設定管理まで実装します。

ただし**本番の証券会社APIによる実発注はデフォルトで絶対に有効化しない**こと。LiveBrokerAdapter の実装枠と
安全ゲートは作るが、初期状態では `tradingMode=backtest | paper` のみ許可します。

---

## 0. 改訂の方針（最重要）

今回の改訂の目的は、バックテストで **AIが自動的に戦略を取捨選択・調整できる**ようにすることです。
単に勝率を上げるのではなく、次の指標を総合的に改善することを目標にします。

- `finalEquityJpy`
- `totalReturnPct`
- `annualizedReturnPct`
- `maxDrawdownPct`（小さくする）
- `profitFactor`
- `avgWinPct`
- `avgLossPct`
- `riskAdjustedReturn`（= 例: totalReturnPct / maxDrawdownPct、または年率/DD）
- `tradeCount` の過剰減少防止（フィルタの掛けすぎで取引が枯れないこと）

勝率改善・期待値改善のための追加要素は、**本当に効果が出る可能性が高いものだけ**に絞ります。
根拠が弱い／データ取得が難しい／AIの主観に寄りすぎる要素は初回実装に入れません。

### 採用する追加要素（初回実装に含める／これだけ）

1. EarningsQualityScore
2. GapOverheatPenalty
3. FollowThroughFilter
4. MarketRegimeFilter
5. RelativeStrengthScore
6. LossTypeClassification
7. Ablation Test
8. Champion / Challenger Auto Evaluation

### 初回実装に含めない要素（将来拡張用の TODO / interface 程度は可。売買判断には使わない）

- PEADOpportunityScore
- 外国人保有比率 / 個人投資家比率
- アナリストカバレッジ
- 信用需給フィルター
- 100億円ストーリースコア
- IR説明資料の主観的な強さスコア
- SNS人気度 / テーマ株人気度

**理由:** これらはデータ取得難易度・更新頻度・主観性・過剰最適化リスクが高い。初回は
「価格・出来高・決算数値・地合い・相対強度・トレード結果」という**検証可能な要素**に絞る。

---

## 1. 技術スタック・構成（完成形）

- TypeScript / pnpm workspace monorepo / Node.js 20+
- Frontend: Next.js App Router、UI: shadcn/ui、Chart: recharts または lightweight-charts
- Backend: Fastify、DB: PostgreSQL、ORM: Prisma、Validation: zod、Test: Vitest、E2E: Playwright
- Lint: ESLint、Format: Prettier、Docker Compose

```
apps/
  web/   Next.js ダッシュボード
  api/   Fastify (modules: backtest / paper / broker / agent / market-data / disclosures /
         portfolio / strategy / risk / evolution / reports / settings / audit / scheduler / ablation)
packages/
  core/    純粋ロジック（types / strategy / risk / backtest engine / scheduler / market / portfolio /
           broker / evolution / advancedFilters）
  db/      Prisma schema + seed（PostgreSQL）
  hermes/  HermesAgentClient interface + MockHermesAgentClient + OpenHermesAgentClient + prompts
```

### 中核コンセプト（不変）

- **HermesAgent はトレーダー**。`AgentTaskContext`(JSON) だけを根拠に判断し、定義済み Trade API
  （BrokerAdapter）だけを呼ぶ。証券APIキー・Brokerの生APIには一切触れない。
- BrokerAdapter は `BacktestBrokerAdapter`（完全実装）/ `PaperBrokerAdapter`（擬似運用・本番発注しない）/
  `LiveBrokerAdapter`（既定で無効・安全ゲート）の3実装を差し替え可能。
- MarketDataProvider は `SeedMarketDataProvider` / `CsvMarketDataProvider` / `ExternalMarketDataProvider`
  (interface) を差し替え可能。全読み取りを `date` で範囲制限し、**未来情報を渡さない**。
- VirtualClock + BacktestVirtualScheduler で日次イベント（prepare_watchlist → monitor_and_trade →
  pre_lunch_review → pre_close_review → after_close_analysis）を時系列発火。RealtimeMarketScheduler は
  Paper/Live 用に実時刻でセッションイベントを発火。
- すべての AI 判断（input/output JSON）・売買理由・SchedulerEvent・rejected order・監査ログを DB 保存。

（バックテスト約定モデル・リスクルール・基本スキーマ・基本 API/UI は完成形仕様のとおり。本改訂は
そこに「戦略品質・AI自動改善」の層を追加する。）

---

## 2. StrategyConfig への追加（advancedFilters）

すべての追加フィルターは **StrategyConfig で ON/OFF・パラメータ調整可能**にすること。

```jsonc
{
  "advancedFilters": {
    "earningsQuality": {
      "enabled": true,
      "weight": 20,
      "minScoreToBuy": 60,
      "penalizeNoSalesGrowth": true,
      "penalizeOneTimeProfit": true,
      "penalizeOperatingMarginDeterioration": true
    },
    "gapOverheat": {
      "enabled": true,
      "gapSoftPenaltyPct": 8,
      "gapWaitThresholdPct": 12,
      "gapStrongPenaltyPct": 15,
      "gapNoBuyPct": 20,
      "noBuyStopHigh": true
    },
    "followThrough": {
      "enabled": true,
      "minDaysAfterEarnings": 2,
      "maxDaysAfterEarnings": 5,
      "requireAboveEarningsDayLow": true,
      "minVolumeRatio20d": 1.5,
      "requireAboveMa25": true,
      "allowImmediateBuyIfHighQualityAndNotOverheated": true
    },
    "marketRegime": {
      "enabled": true,
      "reduceExposureBelowMa25": true,
      "stopNewBuyBelowMa75": true,
      "badRegimePositionSizeMultiplier": 0.5
    },
    "relativeStrength": {
      "enabled": true,
      "lookbackDaysShort": 20,
      "lookbackDaysLong": 60,
      "compareWithMarketIndex": true
    },
    "lossTypeClassification": { "enabled": true },
    "ablationTest": { "enabled": true }
  }
}
```

`packages/core/src/strategy/advancedFilters/` 配下に各フィルターを純粋関数として実装し、Vitestで単体検証する。

---

## 3. EarningsQualityScore

**目的:** 見た目だけ良い決算・一過性利益・売上を伴わない利益増を避ける。

計算項目: `salesGrowthScore` / `operatingProfitGrowthScore` / `operatingMarginImprovementScore` /
`oneTimeProfitRiskPenalty` / `noSalesGrowthPenalty` / `operatingMarginDeteriorationPenalty` /
`guidanceRevisionScore` / `finalEarningsQualityScore`

ルール:
- 売上YoY +10%以上で加点
- 営業利益YoY +20%以上で加点
- 営業利益率が前年同期比で改善なら加点
- 売上成長なしで利益だけ伸びている場合は強く減点
- 一過性要因（特別利益・為替益・補助金・資産売却益など）が `rawText`/`summary` にあれば減点
- 営業利益率悪化なら減点
- 上方修正で加点 / 下方修正は買い禁止または強く減点

保存（TradeEpisode.featuresAtEntryJson と AgentContext）:
```jsonc
{ "earningsQuality": {
  "score": number, "salesGrowthScore": number, "operatingProfitGrowthScore": number,
  "operatingMarginImprovementScore": number, "oneTimeProfitRiskPenalty": number,
  "noSalesGrowthPenalty": number, "positiveFactors": string[], "negativeFactors": string[],
  "oneTimeProfitRisk": "low" | "medium" | "high" } }
```

---

## 4. GapOverheatPenalty

**目的:** 決算翌日の高値掴みを避ける。`postEarningsGapPct` = 決算発表前終値 → 翌営業日始値の上昇率。

ルール:
- +8%以上で軽い減点
- +12%以上で即買いせず FollowThrough 待ち
- +15%以上で強い減点
- +20%以上で原則買い禁止
- ストップ高張り付き相当なら原則買い禁止
- 後日 FollowThroughFilter を満たせば再検討可

保存:
```jsonc
{ "gapOverheat": { "postEarningsGapPct": number, "penalty": number,
  "requiresFollowThrough": boolean, "noBuyReason": string | null } }
```

---

## 5. FollowThroughFilter

**目的:** 決算翌日だけ上がって崩れる銘柄を避ける。

条件: 決算後2〜5営業日以内 / 決算翌日の安値を終値で割っていない / 出来高20日平均比1.5倍以上 /
終値が25日線上 / 終値が決算前終値を上回る。

ルール:
- `gapOverheat.requiresFollowThrough = true` の銘柄はこのfilter通過まで買わない
- 決算の質が高く gap < +8% なら即買い許可
- 質が中程度、または gap >= +8% は FollowThrough 確認後に買う

保存:
```jsonc
{ "followThrough": { "passed": boolean, "daysAfterEarnings": number, "aboveEarningsDayLow": boolean,
  "volumeRatio20d": number, "aboveMa25": boolean, "reason": string } }
```

---

## 6. MarketRegimeFilter

**目的:** 中小型グロース市場が悪い時に新規買いを抑制し最大DDを下げる。

SeedMarketDataProvider に疑似グロース指数 `GROWTH_MOCK` を追加。
計算: `marketIndexClose` / `marketIndexMa25` / `marketIndexMa75` / `marketRegime: risk_on|neutral|risk_off`。

ルール:
- 指数が25日線上: 通常運用
- 指数が25日線下: 新規買い予算 0.5倍
- 指数が75日線下: 新規買い停止
- **保有銘柄の損切り・利確・撤退は地合いに関係なく通常通り実行（売り判断は止めない）**

保存（AgentContext と featuresAtEntryJson）:
```jsonc
{ "marketRegime": { "indexCode": "GROWTH_MOCK", "close": number, "ma25": number, "ma75": number,
  "regime": "risk_on"|"neutral"|"risk_off", "positionSizeMultiplier": number, "allowNewBuy": boolean } }
```

---

## 7. RelativeStrengthScore

**目的:** 市場より強い銘柄を優先する。

計算: `stockReturn20d` / `marketReturn20d` / `relativeReturn20d` / `stockReturn60d` / `marketReturn60d` /
`relativeReturn60d` / `finalRelativeStrengthScore`。

ルール: 20日相対リターン＋で加点 / 60日相対リターン＋で加点 / 20日・60日ともに弱いと減点 /
相対強度が弱い銘柄は買い優先度を下げる / **相対強度だけで買い判断はしない**。

保存:
```jsonc
{ "relativeStrength": { "stockReturn20d": number, "marketReturn20d": number, "relativeReturn20d": number,
  "stockReturn60d": number, "marketReturn60d": number, "relativeReturn60d": number, "score": number } }
```

---

## 8. AgentTradingDecision に doNotBuyReasons を追加

```jsonc
{
  "decision": "buy" | "sell" | "hold" | "watch" | "skip",
  "symbol": "string",
  "strategy": "earnings_momentum" | "new_high_breakout" | "roe_growth" | "risk_management",
  "budgetJpy": number | null, "limitPrice": number | null, "sellPositionPct": number | null,
  "confidence": number, "expectedHoldingDays": number | null, "stopLossPct": number | null,
  "reason": "string",
  "doNotBuyReasons": string[],
  "thesis": "string", "riskFactors": string[], "invalidationConditions": string[]
}
```

ルール:
- buy 判断でも `doNotBuyReasons` を最低1つ出す（検討した不安要素を明示）
- skip 判断では詳しく出す
- `doNotBuyReasons` が空なら **zod validation error**
- `doNotBuyReasons` は `AgentRun.outputJson` / `Order` / `TradeEpisode.featuresAtEntryJson` に保存

### PositionThesis / InvalidationCondition Monitoring 強化

買い時に必ず保存: `thesis` / `invalidationConditions` / `doNotBuyReasons` / `earningsQuality` /
`gapOverheat` / `followThrough` / `marketRegime` / `relativeStrength`。

毎営業日の `pre_close_review` または `after_close_analysis` で保有銘柄の invalidationConditions を評価
（-8% / 25日線終値割れ / 決算翌日安値割れ / 出来高を伴う大陰線 / 次回決算で利益率改善が止まる /
AIが thesis_broken と判定 など）。該当したら sell または reduce を検討し理由を保存。

---

## 9. LossTypeClassification

**目的:** AIがバックテスト結果から「なぜ負けたか」を学び、次の Challenger で条件調整できるようにする。

`TradeEpisode` に `lossType` カラム（または `outcomeLabelsJson.lossType`）を追加。

分類: `chased_gap_up` / `weak_earnings_quality` / `market_regime_bad` / `no_follow_through` /
`stop_loss_normal` / `thesis_broken` / `low_relative_strength` / `unknown`。

分類ロジック:
- `gapOverheat.postEarningsGapPct >= 12` かつ損失 → `chased_gap_up`
- `earningsQuality.score < 60` かつ損失 → `weak_earnings_quality`
- `marketRegime.regime = risk_off` 中の買いで損失 → `market_regime_bad`
- `followThrough.passed = false` なのに買って損失 → `no_follow_through`
- `relativeStrength.score` が低く損失 → `low_relative_strength`
- invalidation condition 該当で売却 → `thesis_broken`
- 通常の-8%損切り → `stop_loss_normal`
- 判定不能 → `unknown`

---

## 10. BacktestSummaryForAI 拡張

```jsonc
{
  "lossTypeStats": [
    { "lossType": "chased_gap_up", "tradeCount": number, "totalLossJpy": number,
      "avgReturnPct": number, "examples": [] }
  ],
  "filterAttribution": [
    { "filterName": "earningsQuality", "enabled": true, "tradeCount": number,
      "avgReturnPct": number, "winRatePct": number, "profitFactor": number }
  ]
}
```

---

## 11. Ablation Test

**目的:** どの追加フィルターが本当に損益改善に効いたかを確認する。

API: `POST /api/backtests/:id/ablation`
動作: 既存 BacktestRun の条件を元に、以下の StrategyVersion を自動生成し**同一期間**でバックテスト:
- `base`（既存Champion）
- `earnings-quality-only`
- `gap-overheat-only`
- `follow-through-only`
- `market-regime-only`
- `relative-strength-only`
- `quality-gap-followthrough`
- `all-selected-advanced-filters`

`AblationResult` テーブルを追加:
`id / sourceBacktestRunId / name / strategyVersionId / backtestRunId / finalEquityJpy / totalReturnPct /
annualizedReturnPct / maxDrawdownPct / winRatePct / profitFactor / avgWinPct / avgLossPct / tradeCount / createdAt`

UI: `/backtests/[id]/ablation`（finalEquity / totalReturnPct / annualizedReturnPct / maxDrawdownPct /
profitFactor / winRatePct / avgWinPct / avgLossPct / tradeCount / bestTrade / worstTrade を比較表示）。

---

## 12. Champion / Challenger Auto Evaluation

Challenger を Champion 候補にするのは**以下を全て満たす時のみ**:
- `finalEquityJpy` が Champion 以上
- `profitFactor` が Champion 以上
- `maxDrawdownPct` が Champion より大きく悪化していない
- `tradeCount` が少なすぎない
- `avgLossPct` が悪化していない
- 特定1銘柄だけの勝ちではない
- train / validation / test のうち validation・test でも極端に悪化していない

**自動で本番戦略にはしない。** ただし Backtest/Paper 上では AI が Challenger を自動作成・自動比較・自動改善してよい。

### Evolution Engine（lossTypeStats 駆動の改善提案）

- `chased_gap_up` が多い → `gapWaitThresholdPct` を下げる / `gapNoBuyPct` を下げる / FollowThrough 必須を強める
- `weak_earnings_quality` が多い → `earningsQuality.minScoreToBuy` を上げる / `oneTimeProfitRisk=high` を買い禁止
- `market_regime_bad` が多い → `badRegimePositionSizeMultiplier` を下げる / risk_off で新規買い停止を強制
- `no_follow_through` が多い → followThrough の出来高条件を強める / 確認期間を 2〜7営業日に広げる
- `low_relative_strength` が多い → relativeStrength の最低スコアを上げる

---

## 13. UI 追加・修正

追加画面:
- `/backtests/[id]/advanced-filters` — 各トレードの advanced filter score（earningsQuality / gapOverheat /
  followThrough / marketRegime / relativeStrength / doNotBuyReasons）
- `/backtests/[id]/loss-analysis` — lossType別集計 / lossTypeごとの損失額 / 代表トレード / AI改善提案
- `/backtests/[id]/ablation` — Ablation比較表（Champion vs Challenger vs 各フィルター構成）

既存 Trade detail に追加表示: `earningsQuality` / `gapOverheat` / `followThrough` / `marketRegime` /
`relativeStrength` / `doNotBuyReasons` / `lossType`。

---

## 14. テスト（追加・必須）

- 一過性利益キーワードがある決算は EarningsQualityScore が下がる
- 売上成長なしの利益増は減点される
- `postEarningsGapPct >= 12` で `requiresFollowThrough` になる
- `postEarningsGapPct >= 20` で原則買い禁止
- followThrough 条件を満たすと買い候補に戻る
- marketIndex が75日線下なら新規買い停止
- relativeStrength が市場より弱いと減点
- `doNotBuyReasons` が空なら AgentDecision validation error
- 損失トレードに lossType が付く
- chased_gap_up / weak_earnings_quality / market_regime_bad / no_follow_through / low_relative_strength
  がそれぞれ正しく分類される
- Ablation test が複数 BacktestRun を生成する / AblationResult が保存される
- Evolution Engine が lossTypeStats に応じた改善案を返す

（既存の Broker/Risk/Execution/Accounting/Scheduler/Evolution テストは維持）

---

## 15. README 更新

追加説明:
- なぜ追加フィルターをこの5つ（+分類/Ablation/AutoEval）に絞ったか
- EarningsQualityScore / GapOverheatPenalty / FollowThroughFilter / MarketRegimeFilter /
  RelativeStrengthScore / LossTypeClassification / Ablation Test / Champion・Challenger Auto Evaluation
- 勝率だけでなく**期待値・PF・最大DD**を見るべき理由
- PEAD・信用需給・100億円ストーリー等を初回実装から外した理由

---

## 16. 絶対に守る制約

- 追加フィルターをいきなり Champion にしない（必ず比較を経る）
- すべて StrategyConfig で ON/OFF 可能
- フィルター結果はすべて `featuresAtEntryJson` に保存
- 実装後、既存 Champion と新 Challenger で**同一期間のバックテスト比較**を行う
- さらに Ablation test で、どの要素が効いたかを比較する
- 損益が改善しない場合は、その結果を**正直に表示**する
- AI がバックテスト結果を見て、効いていないフィルターを**弱める・無効化する提案**を出せるようにする
- 勝率が上がっても finalEquity / profitFactor が悪化するなら採用しない
- tradeCount が極端に減るフィルターは**過剰最適化として警告**する
- 本番証券APIに接続しない / 本番発注を有効化しない / APIキー・口座情報を要求しない
- LiveBrokerAdapter は disabled から始める
- AI判断・売買理由・input/output・SchedulerEvent・rejected order・監査ログを必ず DB 保存
- seedデータで取引が発生し、ブラウザで結果が見えるところまで実装する
- テストを必ず通す

---

## 付録: 除外要素の TODO 方針

PEADOpportunityScore / 外国人・個人保有比率 / アナリストカバレッジ / 信用需給 / 100億円ストーリー /
IR主観スコア / SNS・テーマ人気度 は **interface / TODO コメントのみ**可とし、売買判断・スコアリングには
一切使用しない。将来データソースが安定したら別フェーズで検証する。
