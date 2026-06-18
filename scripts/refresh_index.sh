#!/bin/bash
# Daily refresh of the market-regime index (IndexDailyPrice / 2516.T). Wired to a
# launchd LaunchAgent so the MarketRegimeFilter stays current.
set -euo pipefail
cd "$(dirname "$0")/.."
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
export DATABASE_URL
exec /opt/homebrew/bin/node scripts/ingest_index.mjs
