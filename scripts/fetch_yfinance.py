#!/usr/bin/env python3
import sys
import json
import argparse
import traceback

try:
    import yfinance as yf
    import pandas as pd
except ImportError:
    print(json.dumps({
        "ok": False,
        "error": "Missing dependencies. Run: pip install yfinance pandas"
    }))
    sys.exit(1)

def run_daily(args):
    ticker = yf.Ticker(args.symbol)
    # yfinance history uses YYYY-MM-DD
    # Fetch data
    df = ticker.history(start=args.start, end=args.to, interval="1d")
    
    if df.empty:
        # Retry with uppercase or fallback without period if yfinance had temporary issue
        df = ticker.history(period="max", interval="1d")
        if not df.empty:
            df = df.loc[args.start:args.to]

    rows = []
    for date, row in df.iterrows():
        date_str = date.strftime("%Y-%m-%d")
        rows.append({
            "date": date_str,
            "open": float(row.get("Open", 0)),
            "high": float(row.get("High", 0)),
            "low": float(row.get("Low", 0)),
            "close": float(row.get("Close", 0)),
            "adjClose": float(row.get("Close", 0)), # yfinance history adjusts automatically unless auto_adjust=False
            "volume": float(row.get("Volume", 0)),
            "dividend": float(row.get("Dividends", 0)),
            "split": float(row.get("Stock Splits", 0))
        })
    
    return {
        "ok": True,
        "symbol": args.symbol,
        "rows": rows
    }

def run_dividends(args):
    ticker = yf.Ticker(args.symbol)
    df = ticker.history(start=args.start, end=args.to, interval="1d")
    rows = []
    if not df.empty and "Dividends" in df.columns:
        div_df = df[df["Dividends"] > 0]
        for date, row in div_df.iterrows():
            rows.append({
                "date": date.strftime("%Y-%m-%d"),
                "dividend": float(row["Dividends"])
            })
    return {
        "ok": True,
        "symbol": args.symbol,
        "rows": rows
    }

def run_financials(args):
    ticker = yf.Ticker(args.symbol)
    # yfinance provides .financials, .balance_sheet, .cashflow
    # We serialize income_stmt, balance_sheet, cashflow into JSON
    
    financials = ticker.financials
    balance_sheet = ticker.balance_sheet
    cashflow = ticker.cashflow
    
    # helper to convert pandas dataframe to dict with string keys (dates)
    def clean_df(df):
        if df is None or df.empty:
            return {}
        d = {}
        for col in df.columns:
            date_str = col.strftime("%Y-%m-%d") if hasattr(col, "strftime") else str(col)
            d[date_str] = {k: (float(v) if pd.notna(v) else None) for k, v in df[col].items()}
        return d

    return {
        "ok": True,
        "symbol": args.symbol,
        "financials": clean_df(financials),
        "balance_sheet": clean_df(balance_sheet),
        "cashflow": clean_df(cashflow)
    }

def main():
    parser = argparse.ArgumentParser(description="Fetch market data from yfinance fallback")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # daily prices parser
    daily_parser = subparsers.add_parser("daily")
    daily_parser.add_argument("--symbol", required=True, help="Stock symbol (e.g. 7203.T)")
    daily_parser.add_argument("--from", dest="start", required=True, help="Start date (YYYY-MM-DD)")
    daily_parser.add_argument("--to", required=True, help="End date (YYYY-MM-DD)")

    # dividends parser
    div_parser = subparsers.add_parser("dividends")
    div_parser.add_argument("--symbol", required=True, help="Stock symbol (e.g. 7203.T)")
    div_parser.add_argument("--from", dest="start", required=True, help="Start date (YYYY-MM-DD)")
    div_parser.add_argument("--to", required=True, help="End date (YYYY-MM-DD)")

    # financials parser
    fin_parser = subparsers.add_parser("financials")
    fin_parser.add_argument("--symbol", required=True, help="Stock symbol (e.g. 7203.T)")

    args = parser.parse_args()

    try:
        if args.command == "daily":
            result = run_daily(args)
        elif args.command == "dividends":
            result = run_dividends(args)
        elif args.command == "financials":
            result = run_financials(args)
        else:
            result = {"ok": False, "error": f"Unknown command: {args.command}"}
        
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        sys.stderr.write(traceback.format_exc())
        print(json.dumps({
            "ok": False,
            "error": str(e)
        }, ensure_ascii=False))
        sys.exit(1)

if __name__ == "__main__":
    main()
