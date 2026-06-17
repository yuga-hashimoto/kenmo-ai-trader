/**
 * Broker Quote Provider — price/board/account inquiry ONLY.
 * MVP: No order placement. LiveBrokerAdapter (order placement) remains disabled.
 * KabuStation implementation is a stub; wire up HTTP calls when ready.
 */

export interface RealtimePrice {
  symbolCode: string;
  currentPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  previousClose: number;
  volume: number;
  turnoverValue: number;
  timestamp: string;
  priceStatus: 'regular' | 'pre_open' | 'after_hours' | 'unavailable';
}

export interface BoardLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

export interface Board {
  symbolCode: string;
  currentPrice: number;
  bidLevels: BoardLevel[];
  askLevels: BoardLevel[];
  timestamp: string;
}

export interface BrokerAccount {
  accountType: string;
  cashBalance: number;
  buyingPower: number;
  marginBalance?: number;
  updatedAt: string;
}

export interface BrokerPosition {
  symbolCode: string;
  symbolName: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnlJpy: number;
  unrealizedPnlPct: number;
  positionType: 'long' | 'short';
}

export interface BrokerOrder {
  orderId: string;
  symbolCode: string;
  side: 'buy' | 'sell';
  orderType: string;
  quantity: number;
  limitPrice: number | null;
  status: string;
  filledQuantity: number;
  createdAt: string;
}

/** Read-only broker interface — price, board, account, positions, orders (no placement). */
export interface BrokerQuoteProvider {
  getRealtimePrice(symbolCode: string): Promise<RealtimePrice>;
  getBoard(symbolCode: string): Promise<Board>;
  getAccount(): Promise<BrokerAccount>;
  getPositions(): Promise<BrokerPosition[]>;
  getOrders(): Promise<BrokerOrder[]>;
}

/** kabuStation API quote provider (au Kabu securities). Inquiry-only. */
export class KabuStationQuoteProvider implements BrokerQuoteProvider {
  private token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly password: string,
  ) {}

  private async getToken(): Promise<string> {
    if (this.token) return this.token;
    const res = await fetch(`${this.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ APIPassword: this.password }),
    });
    if (!res.ok) throw new Error(`KabuStation token -> ${res.status}`);
    const data = (await res.json()) as { Token: string };
    this.token = data.Token;
    return this.token;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { 'X-API-KEY': token },
    });
    if (!res.ok) throw new Error(`KabuStation ${path} -> ${res.status}`);
    return res.json() as Promise<T>;
  }

  async getRealtimePrice(symbolCode: string): Promise<RealtimePrice> {
    type Raw = {
      Symbol: string;
      CurrentPrice: number;
      OpeningPrice: number;
      HighPrice: number;
      LowPrice: number;
      PreviousClose: number;
      TradingVolume: number;
      TradingValue: number;
      CurrentPriceTime: string;
      PriceStatus: number;
    };
    const data = await this.get<Raw>(`/board/${symbolCode}`);
    const statusMap: Record<number, RealtimePrice['priceStatus']> = {
      1: 'pre_open',
      2: 'regular',
      3: 'after_hours',
    };
    return {
      symbolCode: data.Symbol,
      currentPrice: data.CurrentPrice,
      openPrice: data.OpeningPrice,
      highPrice: data.HighPrice,
      lowPrice: data.LowPrice,
      previousClose: data.PreviousClose,
      volume: data.TradingVolume,
      turnoverValue: data.TradingValue,
      timestamp: data.CurrentPriceTime,
      priceStatus: statusMap[data.PriceStatus] ?? 'unavailable',
    };
  }

  async getBoard(symbolCode: string): Promise<Board> {
    type Raw = {
      Symbol: string;
      CurrentPrice: number;
      Board: Array<{
        Price: number;
        Qty: number;
        IsAsk: boolean;
        NumOrders: number;
      }>;
      CurrentPriceTime: string;
    };
    const data = await this.get<Raw>(`/board/${symbolCode}`);
    const bids: BoardLevel[] = [];
    const asks: BoardLevel[] = [];
    for (const b of data.Board ?? []) {
      const level: BoardLevel = { price: b.Price, quantity: b.Qty, orderCount: b.NumOrders };
      if (b.IsAsk) asks.push(level);
      else bids.push(level);
    }
    return {
      symbolCode: data.Symbol,
      currentPrice: data.CurrentPrice,
      bidLevels: bids.sort((a, b) => b.price - a.price),
      askLevels: asks.sort((a, b) => a.price - b.price),
      timestamp: data.CurrentPriceTime,
    };
  }

  async getAccount(): Promise<BrokerAccount> {
    type Raw = {
      StockAccountWallet: number;
      AuKcStockAccountWallet: number;
      MarginAccountWallet: number;
    };
    const data = await this.get<Raw>('/wallet/cash');
    return {
      accountType: 'kabu_station',
      cashBalance: data.StockAccountWallet ?? 0,
      buyingPower: data.AuKcStockAccountWallet ?? 0,
      marginBalance: data.MarginAccountWallet,
      updatedAt: new Date().toISOString(),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    type Raw = {
      Symbol: string;
      SymbolName: string;
      LeavesQty: number;
      Price: number;
      CurrentPrice: number;
      ProfitLoss: number;
      ProfitLossRate: number;
      Side: string;
    };
    const data = await this.get<Raw[]>('/positions');
    return (data ?? []).map((p) => ({
      symbolCode: p.Symbol,
      symbolName: p.SymbolName,
      quantity: p.LeavesQty,
      avgPrice: p.Price,
      currentPrice: p.CurrentPrice,
      unrealizedPnlJpy: p.ProfitLoss,
      unrealizedPnlPct: p.ProfitLossRate,
      positionType: p.Side === '2' ? 'short' : 'long',
    }));
  }

  async getOrders(): Promise<BrokerOrder[]> {
    type Raw = {
      ID: string;
      Symbol: string;
      Side: string;
      CashMargin: number;
      Qty: number;
      Price: number;
      OrderState: number;
      CumQty: number;
      ReceiveTime: string;
    };
    const data = await this.get<Raw[]>('/orders');
    return (data ?? []).map((o) => ({
      orderId: o.ID,
      symbolCode: o.Symbol,
      side: o.Side === '2' ? 'buy' : 'sell',
      orderType: o.CashMargin === 1 ? 'cash' : 'margin',
      quantity: o.Qty,
      limitPrice: o.Price > 0 ? o.Price : null,
      status: String(o.OrderState),
      filledQuantity: o.CumQty,
      createdAt: o.ReceiveTime,
    }));
  }
}

export class DisabledBrokerQuoteProvider implements BrokerQuoteProvider {
  private err(): never {
    throw new Error('BrokerQuoteProvider is disabled (set KABU_STATION_ENABLED=true)');
  }

  async getRealtimePrice(_symbolCode: string): Promise<RealtimePrice> { return this.err(); }
  async getBoard(_symbolCode: string): Promise<Board> { return this.err(); }
  async getAccount(): Promise<BrokerAccount> { return this.err(); }
  async getPositions(): Promise<BrokerPosition[]> { return this.err(); }
  async getOrders(): Promise<BrokerOrder[]> { return this.err(); }
}

export function createBrokerQuoteProvider(
  env: NodeJS.ProcessEnv = process.env,
): BrokerQuoteProvider {
  if (env.KABU_STATION_ENABLED !== 'true') return new DisabledBrokerQuoteProvider();
  const baseUrl = env.KABU_STATION_API_BASE_URL ?? 'http://localhost:18080/kabusapi';
  const password = env.KABU_STATION_PASSWORD ?? '';
  if (!password) {
    console.warn('KABU_STATION_ENABLED=true but KABU_STATION_PASSWORD not set — disabled');
    return new DisabledBrokerQuoteProvider();
  }
  return new KabuStationQuoteProvider(baseUrl, password);
}
