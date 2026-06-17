# kenmo-ai-trader

kenmo氏の中小型成長株投資法をベースに、**HermesAgent** が日本株を対象に自動で銘柄分析・売買判断・
バックテスト・Paper運用・戦略改善（Champion / Challenger）を行うAI投資システムです。

> ⚠️ **本番発注は行いません。** 既定の取引モードは `backtest` / `paper` のみ。`LiveBrokerAdapter`
> は安全stubで、`ENABLE_LIVE_TRADING=true` かつ確認フローを経ない限り注文を送信しません。APIキーや
> 証券口座情報は要求しません。

---

## アーキテクチャ

```
apps/
  web/   Next.js (App Router) ダッシュボード
  api/   Fastify API (modules: backtest / paper / broker / agent / market-data /
         portfolio / strategy / evolution / reports / settings / audit)
packages/
  core/    純粋ロジック（types / strategy / risk / backtest engine / scheduler / market / portfolio / broker / evolution）
  db/      Prisma schema + seed（PostgreSQL）
  hermes/  HermesAgentClient interface + MockHermesAgentClient + OpenHermesAgentClient + prompts
```

**HermesAgent はトレーダー**です。`AgentTaskContext`(JSON) だけを根拠に売買を判断し、定義済みの
**Trade API（BrokerAdapter）**だけを呼びます。証券APIキーやBrokerの生APIには一切触れません。

```
HermesAgent ──> BrokerAdapter ──┬─ BacktestBrokerAdapter (in-memory sim / 日足OHLCV約定)
                                ├─ PaperBrokerAdapter     (擬似運用・本番発注しない)
                                └─ LiveBrokerAdapter      (disabled stub / 将来 kabu station API 等)
```

MarketDataProvider は `SeedMarketDataProvider` / `CsvMarketDataProvider` / 将来の
`ExternalMarketDataProvider` を差し替え可能。すべての読み取りは `date` で範囲制限され、**未来情報を渡しません**。

---

## セットアップ（Docker Compose / 推奨）

```bash
cp .env.example .env
docker compose up --build
```

起動時に自動で `prisma db push`（スキーマ反映）→ `seed`（サンプルデータ投入）→ API起動 を行います。

- Web:  http://localhost:3000
- API:  http://localhost:4000  (health: http://localhost:4000/health)
- DB:   postgres://kenmo:kenmo@localhost:5432/kenmo

## セットアップ（ローカル / pnpm）

```bash
pnpm install                     # 依存インストール（esbuild/prisma のビルド承認が必要なら pnpm approve-builds --all）
cp .env.example .env             # DATABASE_URL を自分のPostgresに合わせる

pnpm db:generate                 # Prisma Client 生成
pnpm db:push                     # スキーマをDBへ反映（または pnpm db:migrate）
pnpm db:seed                     # 5銘柄 / 約2年の日足 / 決算 / 開示 / Champion(kenmo-v1) を投入

pnpm dev:api                     # API  http://localhost:4000
pnpm dev:web                     # Web  http://localhost:3000
```

---

## 使い方

1. ブラウザで `/backtests/new` を開く
2. 元本・信用ON/OFF・期間・戦略バージョンを入力
3. 「作成して実行」→ HermesAgentが仮想スケジューラ上でkenmo式に自動売買
4. `/backtests/[id]` で 資産推移 / ドローダウン / 月次損益 / 勝率 / PF / 売買回数 を確認
5. 売買履歴・トレード詳細（thesis / 撤退条件 / features at entry）・AI判断ログ・スケジューライベントを確認
6. 「AI改善 / Challenger」タブで Challenger戦略を生成 → `/strategies` で比較・昇格(promote)
7. `/paper/new` で Paper運用を開始（pause / resume / stop / 再実行）

### バックテストの仕組み

- `VirtualClock` が営業日を1日ずつ進め、各日に仮想イベントを発火します:
  `08:30 prepare_watchlist → 09:05/10:30/12:35/14:30 monitor_and_trade → 15:20 pre_close_review → 15:40 after_close_analysis`
- 各イベントで `AgentTaskContext` を生成し HermesAgent を呼び、出力(JSON)を **zod検証** して `AgentRun` に保存。
- 売買判断は BacktestBrokerAdapter に渡り、**日足OHLCVで約定判定**します:
  - 指値買い: 対象日の `low <= 指値` で約定。`open < 指値` なら始値で約定（価格改善）
  - 損切り: `low <= stop` で約定。ギャップダウン（`open <= stop`）時は **始値**で約定
  - +20%で一部利確（一度だけ）、高値から-12%でトレーリング撤退
  - 手数料(5bps)・スリッページ(10bps)を計上
  - 発注不可（余力超過・ナンピン・成行・理由なし・確信度不足）は **rejected order** としてDB保存
- 日次で `PortfolioSnapshot`、決済ごとに `TradeEpisode` を生成。終了後に `BacktestSummary` を計算。

### スケジューラ

- `BacktestVirtualScheduler`（実装・常用）: 過去データを時系列に再生。
- `RealtimeMarketScheduler`（将来 Paper/Live 用）: 現在時刻でタスクを発火する設計。MVPでは未稼働。

---

## HermesAgent の差し替え

`packages/hermes` の `HermesAgentClient` interface を実装すれば差し替え可能です。

- `MockHermesAgentClient`（既定）: 完全に動くルールベースAI。kenmo式の候補スコアで buy、保有銘柄が
  stop/trailing 条件で sell。出力は必ず zod 検証。
- `OpenHermesAgentClient`: 実HermesAgentサービスへの接続口。`.env` の
  `HERMES_MODE=remote` + `HERMES_AGENT_ENDPOINT` / `HERMES_AGENT_API_KEY` / `HERMES_AGENT_MODEL`
  を設定。未設定や失敗時は自動で Mock にフォールバックします。

---

## BrokerAdapter

| Adapter | 状態 | 説明 |
|---|---|---|
| `BacktestBrokerAdapter` | 完全実装 | 日足OHLCVで約定/損切り/利確/トレーリングをシミュレートし内部DBに保存（engineに内蔵） |
| `PaperBrokerAdapter` | 実装 | 本番発注しない擬似運用。`PaperRun` として管理、pause/resume/stop。MarketDataProviderの価格を使用 |
| `LiveBrokerAdapter` | **無効stub** | interfaceのみ。`placeOrder` 等は `LiveTradingDisabledError` を投げる。将来 kabu station API 等に差し替え |

> Paper運用はMVPでは利用可能な履歴を高速再生する方式です。将来 `RealtimeMarketScheduler` が1営業日ずつ
> 進める実装に置き換えられるよう、永続化モデルとUIは既に paper 対応済みです。

---

## Champion / Challenger と Evolution Engine

- 初期 Champion は `kenmo-v1`（seedで作成）。
- バックテスト完了後 `/backtests/[id]/evolve` で `BacktestSummaryForAI` を生成し、
  HermesAgent が `reviewBacktest` で改善案（`configChanges`）を返します。
- 改善案を親configに適用した **Challenger StrategyVersion** を自動作成し、`EvolutionProposal` を保存。
- Challenger を新規バックテストで検証し、`compareStrategies`（過剰最適化対策: 取引回数・最大DD・PFも見る）で
  比較。優れていれば `/strategies` の **Champion昇格(promote)** で切り替え。

---

## 高度フィルター（戦略品質・AI自動改善層 v2）

勝率だけでなく **期待値・Profit Factor・最大DD・riskAdjustedReturn** を改善するため、
検証可能（価格・出来高・決算数値・地合い・相対強度・トレード結果）な高確度の要素だけを採用しています。
すべて `StrategyConfig.advancedFilters` で ON/OFF・調整可能で、結果は `featuresAtEntryJson` に保存されます。

| フィルター | 目的 |
|---|---|
| **EarningsQualityScore** | 一過性利益・売上を伴わない利益増・利益率悪化を減点。下方修正は買い禁止 |
| **GapOverheatPenalty** | 決算翌日の高値掴み回避（+12%でFollowThrough待ち、+20%で原則買い禁止、ストップ高張り付き禁止） |
| **FollowThroughFilter** | 決算翌日だけ上げて崩れる銘柄を回避（2〜5営業日・安値維持・出来高1.5倍・25日線上・決算前終値超え） |
| **MarketRegimeFilter** | 疑似グロース指数 `GROWTH_MOCK` が25日線下で0.5倍・75日線下で新規買い停止（売り判断は止めない） |
| **RelativeStrengthScore** | 市場(指数)比の20日/60日相対リターンで強い銘柄を優先（単独では買わない） |
| **LossTypeClassification** | 各損失を chased_gap_up / weak_earnings_quality / market_regime_bad / no_follow_through / low_relative_strength / stop_loss_normal / thesis_broken に分類 |
| **Ablation Test** | 同一期間でフィルターを1つずつ切り替えて再バックテストし、どれが効いたかを比較（`POST /api/backtests/:id/ablation`、UI `/backtests/[id]/ablation`） |
| **Champion/Challenger Auto Eval** | finalEquity・PF・最大DD・avgLoss・取引回数・銘柄集中度・期間分散を満たす場合のみ昇格候補（自動本番化はしない） |

`AgentTradingDecision.doNotBuyReasons` は全判断で最低1つ必須（空はzodエラー）。Evolution Engine は
`lossTypeStats` を見て、効いていない/負け要因に対応するフィルターを弱める・強める提案を出します。

### なぜこの要素に絞ったか / 初回実装から外したもの

採用したのは **データ取得が容易で、根拠が明確で、過剰最適化になりにくい** 要素のみです。
次は主観性・データ取得難易度・更新頻度・過剰最適化リスクが高いため **初回実装から除外**（interface/TODOのみ）:
PEADOpportunityScore / 外国人・個人保有比率 / アナリストカバレッジ / 信用需給フィルター /
100億円ストーリースコア / IR資料の主観スコア / SNS・テーマ人気度。

> 改訂方針の詳細は [docs/IMPLEMENTATION_PROMPT.md](docs/IMPLEMENTATION_PROMPT.md) を参照。

## テスト

```bash
pnpm test          # core (54) + hermes (8) = 62 tests + Playwright E2E
```

カバー範囲: 余力/信用/レバレッジ/ナンピン/成行/理由/確信度の各リジェクト、指値約定・未約定・損切り・
ギャップダウン始値約定・利確・トレーリング、PortfolioSnapshot/実現損益/含み損益、AgentRun input/output 保存、
SchedulerEvent 時系列、prepare→monitor→after_close フロー、未来日 FinancialResult の非混入、Challenger生成、
promote、戦略比較。

---

## Live運用へ進める前に必要な作業（未実装）

1. 実 `MarketDataProvider`（J-Quants / kabu station 等）と `DisclosureProvider` の接続
2. `RealtimeMarketScheduler` の実稼働化（現在時刻ベースのイベント発火）
3. `LiveBrokerAdapter` に実ブローカー（kabu station API 等）の発注実装 + 約定照合
4. 二重の安全ゲート（`ENABLE_LIVE_TRADING=true` + UI確認 + 監査）の検証
5. 約定スリッページ/板情報/分足の精緻化、ストップ高安の厳密実装
6. リスク限度・障害時のキルスイッチ、ポジション再同期

**現状は本番売買に使用しないでください。**
