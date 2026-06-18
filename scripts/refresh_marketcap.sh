#!/bin/bash
# Weekly market-cap refresh: recompute Symbol.marketCapJpy from yfinance shares
# × latest close, so the strategy's mid/small-cap filter stays accurate as share
# counts and prices drift. Wired to a launchd LaunchAgent (weekly). Loads
# DATABASE_URL from the repo .env so no secret lives in the plist.
set -euo pipefail
cd "$(dirname "$0")/.."
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
export DATABASE_URL
exec /opt/homebrew/bin/node scripts/populate_marketcap.mjs
