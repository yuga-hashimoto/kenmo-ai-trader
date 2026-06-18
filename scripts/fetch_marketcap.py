#!/usr/bin/env python3
"""Read newline-separated Yahoo tickers from stdin, print {ticker: sharesOutstanding}.

Uses yfinance fast_info.shares (fast) with a fallback to .info['sharesOutstanding'].
Market cap is computed on the Node side as shares * latest close, so this script
only needs the (slowly-changing) share count.
"""
import sys
import json

import yfinance as yf


def shares_for(ticker: str):
    try:
        fi = yf.Ticker(ticker).fast_info
        sh = getattr(fi, "shares", None)
        if sh:
            return int(sh)
    except Exception:
        pass
    try:
        sh = yf.Ticker(ticker).info.get("sharesOutstanding")
        return int(sh) if sh else None
    except Exception:
        return None


def main():
    tickers = [line.strip() for line in sys.stdin if line.strip()]
    out = {t: shares_for(t) for t in tickers}
    print(json.dumps(out))


if __name__ == "__main__":
    main()
