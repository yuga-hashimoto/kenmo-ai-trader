/**
 * J-Quants API provider for Japanese market data.
 * Docs: https://jpx-jquants.com/
 * Authentication:
 * - V2: API key via x-api-key header
 * - V1: email/password -> refresh_token -> id_token (legacy)
 */

export interface JQuantsConfig {
  baseUrl: string;
  apiKey?: string;
  email?: string;
  password?: string;
  refreshToken?: string;
  idToken?: string;
  plan: 'free' | 'standard' | 'premium';
  enableAddons: boolean;
}

export interface JQuantsListedInfo {
  Code: string;
  CompanyName: string;
  CompanyNameEnglish: string;
  Sector17Code: string;
  Sector17CodeName: string;
  Sector33Code: string;
  Sector33CodeName: string;
  ScaleCategory: string;
  MarketCode: string;
  MarketCodeName: string;
}

interface JQuantsV2ListedInfo {
  Code: string;
  CoName: string;
  CoNameEn: string;
  S17: string;
  S17Nm: string;
  S33: string;
  S33Nm: string;
  ScaleCat: string;
  Mkt: string;
  MktNm: string;
}

export interface JQuantsDailyQuote {
  Date: string;
  Code: string;
  Open: number | null;
  High: number | null;
  Low: number | null;
  Close: number | null;
  UpperLimit: string;
  LowerLimit: string;
  Volume: number | null;
  TurnoverValue: number | null;
  AdjustmentFactor: number;
  AdjustmentOpen: number | null;
  AdjustmentHigh: number | null;
  AdjustmentLow: number | null;
  AdjustmentClose: number | null;
  AdjustmentVolume: number | null;
}

interface JQuantsV2DailyQuote {
  Date: string;
  Code: string;
  O: number | null;
  H: number | null;
  L: number | null;
  C: number | null;
  UL: string;
  LL: string;
  Vo: number | null;
  Va: number | null;
  AdjFactor: number;
  AdjO: number | null;
  AdjH: number | null;
  AdjL: number | null;
  AdjC: number | null;
  AdjVo: number | null;
}

export interface JQuantsIndexQuote {
  Date: string;
  Code: string;
  Open: number | null;
  High: number | null;
  Low: number | null;
  Close: number | null;
  Volume: number | null;
}

export interface JQuantsStatement {
  DisclosedDate: string;
  DisclosedTime: string;
  LocalCode: string;
  DisclosureNumber: string;
  TypeOfDocument: string;
  TypeOfCurrentPeriod: string;
  CurrentPeriodStartDate: string;
  CurrentPeriodEndDate: string;
  CurrentFiscalYearStartDate: string;
  CurrentFiscalYearEndDate: string;
  NextFiscalYearStartDate: string;
  NextFiscalYearEndDate: string;
  NetSales: string;
  OperatingProfit: string;
  OrdinaryProfit: string;
  Profit: string;
  EarningsPerShare: string;
  DilutedEarningsPerShare: string;
  TotalAssets: string;
  Equity: string;
  EquityToAssetRatio: string;
  BookValuePerShare: string;
  CashFlowsFromOperatingActivities: string;
  CashFlowsFromInvestingActivities: string;
  CashFlowsFromFinancingActivities: string;
  CashAndEquivalents: string;
  ResultDividendPerShare1stQuarter: string;
  ResultDividendPerShare2ndQuarter: string;
  ResultDividendPerShare3rdQuarter: string;
  ResultDividendPerShareFiscalYearEnd: string;
  ResultDividendPerShareAnnual: string;
  DistributionsPerUnit: string;
  ResultTotalDividendPaidAnnual: string;
  ResultPayoutRatioAnnual: string;
  ForecastDividendPerShare1stQuarter: string;
  ForecastDividendPerShare2ndQuarter: string;
  ForecastDividendPerShare3rdQuarter: string;
  ForecastDividendPerShareFiscalYearEnd: string;
  ForecastDividendPerShareAnnual: string;
  ForecastDistributionsPerUnit: string;
  ForecastTotalDividendPaidAnnual: string;
  ForecastPayoutRatioAnnual: string;
  NextYearForecastDividendPerShare1stQuarter: string;
  NextYearForecastDividendPerShare2ndQuarter: string;
  NextYearForecastDividendPerShare3rdQuarter: string;
  NextYearForecastDividendPerShareFiscalYearEnd: string;
  NextYearForecastDividendPerShareAnnual: string;
  NextYearForecastDistributionsPerUnit: string;
  NextYearForecastPayoutRatioAnnual: string;
  ForecastNetSales2ndQuarter: string;
  ForecastOperatingProfit2ndQuarter: string;
  ForecastOrdinaryProfit2ndQuarter: string;
  ForecastProfit2ndQuarter: string;
  ForecastEarningsPerShare2ndQuarter: string;
  NextYearForecastNetSales2ndQuarter: string;
  NextYearForecastOperatingProfit2ndQuarter: string;
  NextYearForecastOrdinaryProfit2ndQuarter: string;
  NextYearForecastProfit2ndQuarter: string;
  NextYearForecastEarningsPerShare2ndQuarter: string;
  ForecastNetSales: string;
  ForecastOperatingProfit: string;
  ForecastOrdinaryProfit: string;
  ForecastProfit: string;
  ForecastEarningsPerShare: string;
  NextYearForecastNetSales: string;
  NextYearForecastOperatingProfit: string;
  NextYearForecastOrdinaryProfit: string;
  NextYearForecastProfit: string;
  NextYearForecastEarningsPerShare: string;
  NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYearIncludingTreasuryStock: string;
  NumberOfTreasuryStockAtTheEndOfFiscalYear: string;
  AverageNumberOfShares: string;
  NonConsolidatedNetSales: string;
  NonConsolidatedOperatingProfit: string;
  NonConsolidatedOrdinaryProfit: string;
  NonConsolidatedProfit: string;
  NonConsolidatedEarningsPerShare: string;
  NonConsolidatedTotalAssets: string;
  NonConsolidatedEquity: string;
  NonConsolidatedEquityToAssetRatio: string;
  NonConsolidatedBookValuePerShare: string;
  ForecastNonConsolidatedNetSales2ndQuarter: string;
  ForecastNonConsolidatedOperatingProfit2ndQuarter: string;
  ForecastNonConsolidatedOrdinaryProfit2ndQuarter: string;
  ForecastNonConsolidatedProfit2ndQuarter: string;
  ForecastNonConsolidatedEarningsPerShare2ndQuarter: string;
  NextYearForecastNonConsolidatedNetSales2ndQuarter: string;
  NextYearForecastNonConsolidatedOperatingProfit2ndQuarter: string;
  NextYearForecastNonConsolidatedOrdinaryProfit2ndQuarter: string;
  NextYearForecastNonConsolidatedProfit2ndQuarter: string;
  NextYearForecastNonConsolidatedEarningsPerShare2ndQuarter: string;
  ForecastNonConsolidatedNetSales: string;
  ForecastNonConsolidatedOperatingProfit: string;
  ForecastNonConsolidatedOrdinaryProfit: string;
  ForecastNonConsolidatedProfit: string;
  ForecastNonConsolidatedEarningsPerShare: string;
  NextYearForecastNonConsolidatedNetSales: string;
  NextYearForecastNonConsolidatedOperatingProfit: string;
  NextYearForecastNonConsolidatedOrdinaryProfit: string;
  NextYearForecastNonConsolidatedProfit: string;
  NextYearForecastNonConsolidatedEarningsPerShare: string;
}

export interface JQuantsAnnouncement {
  Date: string;
  Code: string;
  CompanyName: string;
  FiscalYear: string;
  SectorName: string;
  FiscalQuarter: string;
  Section: string;
}

export interface JQuantsDividend {
  AnnouncementDate: string;
  Code: string;
  ReferenceNumber: string;
  StatusCode: string;
  BoardMeetingDate: string;
  InterimDividendDate: string;
  AnnualDividendDate: string;
  InterimDividend: string;
  AnnualDividend: string;
}

export interface JQuantsTradingCalendar {
  Date: string;
  HolidayDivision: string;
}

export interface JQuantsMarginBalance {
  Date: string;
  Code: string;
  ShortMarginTradeVolume: string;
  LongMarginTradeVolume: string;
  ShortNegotiableMarginTradeVolume: string;
  LongNegotiableMarginTradeVolume: string;
  ShortStandardizedMarginTradeVolume: string;
  LongStandardizedMarginTradeVolume: string;
}

export interface JQuantsShortSelling {
  Date: string;
  Sector33Code: string;
  SellingExcludingShortSellingTurnoverValue: string;
  ShortSellingWithRestrictionsTurnoverValue: string;
  ShortSellingWithoutRestrictionsTurnoverValue: string;
}

export interface JQuantsInvestorTypeTrading {
  PublishedDate: string;
  StartDate: string;
  EndDate: string;
  Section: string;
  ProprietaryPurchases: string;
  ProprietarySales: string;
  ProprietaryTotal: string;
  ProprietaryBalance: string;
  BrokeragePurchases: string;
  BrokerageSales: string;
  BrokerageTotal: string;
  BrokerageBalance: string;
}

type JQuantsV2Statement = Record<string, string>;

interface JQuantsV2Announcement {
  Date: string;
  Code: string;
  CoName: string;
  FY: string;
  SectorNm: string;
  FQ: string;
  Section: string;
}

interface JQuantsV2MarginBalance {
  Date: string;
  Code: string;
  ShortMarginOutstanding: number | string;
  LongMarginOutstanding: number | string;
  ShortNegotiableMarginOutstanding: number | string;
  LongNegotiableMarginOutstanding: number | string;
  ShortStandardizedMarginOutstanding: number | string;
  LongStandardizedMarginOutstanding: number | string;
}

export class JQuantsProvider {
  private idToken: string | undefined;
  private refreshToken: string | undefined;
  private tokenExpiresAt: number = 0;

  constructor(private readonly config: JQuantsConfig) {
    this.idToken = config.idToken;
    this.refreshToken = config.refreshToken;
    if (this.idToken) {
      this.tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
    }
  }

  private isV2(): boolean {
    return !!this.config.apiKey || this.config.baseUrl.includes('/v2');
  }

  private async getIdToken(): Promise<string> {
    const now = Date.now();
    if (this.idToken && (this.tokenExpiresAt === 0 || now < this.tokenExpiresAt)) return this.idToken;

    if (this.refreshToken) {
      await this.refreshIdToken();
      if (this.idToken) return this.idToken;
    }

    if (this.config.email && this.config.password) {
      await this.loginWithEmailPassword();
      if (this.idToken) return this.idToken;
    }

    throw new Error('JQuantsProvider: no valid credentials (set JQUANTS_ID_TOKEN or JQUANTS_EMAIL+PASSWORD)');
  }

  private async loginWithEmailPassword(): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/token/auth_user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailaddress: this.config.email, password: this.config.password }),
    });
    if (!res.ok) throw new Error(`JQuants auth_user failed: ${res.status}`);
    const data = (await res.json()) as { refreshToken: string };
    this.refreshToken = data.refreshToken;
    await this.refreshIdToken();
  }

  private async refreshIdToken(): Promise<void> {
    if (!this.refreshToken) return;
    const res = await fetch(`${this.config.baseUrl}/token/auth_refresh?refreshtoken=${this.refreshToken}`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`JQuants auth_refresh failed: ${res.status}`);
    const data = (await res.json()) as { idToken: string };
    this.idToken = data.idToken;
    this.tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000; // 23h (id token is 24h)
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    if (this.isV2()) {
      const rows = await this.getV2Data<unknown>(path, params);
      return { data: rows } as T;
    }

    const token = await this.getIdToken();
    const url = new URL(`${this.config.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`JQuants GET ${path} -> ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async getV2Data<T>(path: string, params?: Record<string, string>): Promise<T[]> {
    if (!this.config.apiKey) throw new Error('JQuantsProvider: no valid credentials (set JQUANTS_API_KEY)');

    const rows: T[] = [];
    let paginationKey: string | undefined;
    do {
      const url = new URL(`${this.config.baseUrl}${path}`);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== '') url.searchParams.set(k, v);
        }
      }
      if (paginationKey) url.searchParams.set('pagination_key', paginationKey);

      const res = await fetch(url.toString(), {
        headers: { 'x-api-key': this.config.apiKey },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`JQuants GET ${path} -> ${res.status}: ${text}`);
      const data = JSON.parse(text) as { data?: T[]; pagination_key?: string };
      rows.push(...(data.data ?? []));
      paginationKey = data.pagination_key;
    } while (paginationKey);

    return rows;
  }

  private toDateStr(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  async fetchListedIssueMaster(date?: Date): Promise<JQuantsListedInfo[]> {
    const params = date ? { date: this.toDateStr(date) } : undefined;
    if (this.isV2()) {
      const rows = await this.getV2Data<JQuantsV2ListedInfo>('/equities/master', params);
      return rows.map((row) => ({
        Code: row.Code,
        CompanyName: row.CoName,
        CompanyNameEnglish: row.CoNameEn,
        Sector17Code: row.S17,
        Sector17CodeName: row.S17Nm,
        Sector33Code: row.S33,
        Sector33CodeName: row.S33Nm,
        ScaleCategory: row.ScaleCat,
        MarketCode: row.Mkt,
        MarketCodeName: row.MktNm,
      }));
    }
    const data = await this.get<{ info: JQuantsListedInfo[] }>('/listed/info', params);
    return data.info;
  }

  async fetchDailyPrices(date: Date): Promise<JQuantsDailyQuote[]> {
    if (this.isV2()) {
      const rows = await this.getV2Data<JQuantsV2DailyQuote>(
        '/equities/bars/daily',
        { date: this.toDateStr(date) },
      );
      return rows.map((row) => this.mapV2DailyQuote(row));
    }
    const data = await this.get<{ daily_quotes: JQuantsDailyQuote[] }>(
      '/prices/daily_quotes',
      { date: this.toDateStr(date) },
    );
    return data.daily_quotes;
  }

  async fetchDailyPricesRange(from: Date, to: Date): Promise<JQuantsDailyQuote[]> {
    if (this.isV2()) {
      const rows = await this.getV2Data<JQuantsV2DailyQuote>(
        '/equities/bars/daily',
        { from: this.toDateStr(from), to: this.toDateStr(to) },
      );
      return rows.map((row) => this.mapV2DailyQuote(row));
    }
    const data = await this.get<{ daily_quotes: JQuantsDailyQuote[] }>(
      '/prices/daily_quotes',
      { from: this.toDateStr(from), to: this.toDateStr(to) },
    );
    return data.daily_quotes;
  }

  async fetchDailyPricesByCode(code: string, from: Date, to: Date): Promise<JQuantsDailyQuote[]> {
    if (this.isV2()) {
      const rows = await this.getV2Data<JQuantsV2DailyQuote>(
        '/equities/bars/daily',
        { code, from: this.toDateStr(from), to: this.toDateStr(to) },
      );
      return rows.map((row) => this.mapV2DailyQuote(row));
    }
    const data = await this.get<{ daily_quotes: JQuantsDailyQuote[] }>(
      '/prices/daily_quotes',
      { code, from: this.toDateStr(from), to: this.toDateStr(to) },
    );
    return data.daily_quotes;
  }

  async fetchIndexDailyPrices(date: Date): Promise<JQuantsIndexQuote[]> {
    if (this.isV2()) {
      const rows = await this.getV2Data<JQuantsV2DailyQuote>('/indices/bars/daily', { date: this.toDateStr(date) });
      return rows.map((row) => this.mapV2IndexQuote(row));
    }
    const data = await this.get<{ indices: JQuantsIndexQuote[] }>(
      '/indices',
      { date: this.toDateStr(date) },
    );
    return data.indices;
  }

  async fetchTopixDailyPrices(date: Date): Promise<JQuantsIndexQuote[]> {
    if (this.isV2()) {
      const rows = await this.getV2Data<JQuantsV2DailyQuote>('/indices/bars/daily/topix', { date: this.toDateStr(date) });
      return rows.map((row) => ({ ...this.mapV2IndexQuote(row), Code: 'TOPIX' }));
    }
    const data = await this.get<{ topix: JQuantsIndexQuote[] }>(
      '/indices/topix',
      { date: this.toDateStr(date) },
    );
    return data.topix;
  }

  async fetchFinancialStatements(date: Date): Promise<JQuantsStatement[]> {
    if (this.isV2()) {
      const rows = await this.getV2Data<JQuantsV2Statement>(
        '/fins/summary',
        { date: this.toDateStr(date) },
      );
      return rows.map((row) => this.mapV2Statement(row));
    }
    const data = await this.get<{ statements: JQuantsStatement[] }>(
      '/fins/statements',
      { date: this.toDateStr(date) },
    );
    return data.statements;
  }

  async fetchFinancialStatementsByCode(code: string): Promise<JQuantsStatement[]> {
    if (this.isV2()) {
      const rows = await this.getV2Data<JQuantsV2Statement>('/fins/summary', { code });
      return rows.map((row) => this.mapV2Statement(row));
    }
    const data = await this.get<{ statements: JQuantsStatement[] }>(
      '/fins/statements',
      { code },
    );
    return data.statements;
  }

  async fetchEarningsCalendar(from: Date, to: Date): Promise<JQuantsAnnouncement[]> {
    if (this.isV2()) {
      const rows = await this.getV2Data<JQuantsV2Announcement>('/equities/earnings-calendar');
      return rows
        .filter((a) => a.Date >= this.toDateStr(from) && a.Date <= this.toDateStr(to))
        .map((row) => ({
          Date: row.Date,
          Code: row.Code,
          CompanyName: row.CoName,
          FiscalYear: row.FY,
          SectorName: row.SectorNm,
          FiscalQuarter: row.FQ,
          Section: row.Section,
        }));
    }
    const data = await this.get<{ announcement: JQuantsAnnouncement[] }>(
      '/fins/announcement',
    );
    const fromStr = this.toDateStr(from);
    const toStr = this.toDateStr(to);
    return data.announcement.filter((a) => a.Date >= fromStr && a.Date <= toStr);
  }

  async fetchDividends(date: Date): Promise<JQuantsDividend[]> {
    const data = await this.get<{ dividends: JQuantsDividend[] }>(
      '/fins/dividend',
      { date: this.toDateStr(date) },
    );
    return data.dividends;
  }

  async fetchTradingCalendar(from: Date, to: Date): Promise<JQuantsTradingCalendar[]> {
    const data = await this.get<{ trading_calendar: JQuantsTradingCalendar[] }>(
      '/markets/trading_calendar',
      { from: this.toDateStr(from), to: this.toDateStr(to) },
    );
    return data.trading_calendar;
  }

  async fetchMarginOutstandings(date: Date): Promise<JQuantsMarginBalance[]> {
    if (this.isV2()) {
      const rows = await this.getV2Data<JQuantsV2MarginBalance>(
        '/markets/margin-interest',
        { date: this.toDateStr(date) },
      );
      return rows.map((row) => ({
        Date: row.Date,
        Code: row.Code,
        ShortMarginTradeVolume: String(row.ShortMarginOutstanding ?? ''),
        LongMarginTradeVolume: String(row.LongMarginOutstanding ?? ''),
        ShortNegotiableMarginTradeVolume: String(row.ShortNegotiableMarginOutstanding ?? ''),
        LongNegotiableMarginTradeVolume: String(row.LongNegotiableMarginOutstanding ?? ''),
        ShortStandardizedMarginTradeVolume: String(row.ShortStandardizedMarginOutstanding ?? ''),
        LongStandardizedMarginTradeVolume: String(row.LongStandardizedMarginOutstanding ?? ''),
      }));
    }
    const data = await this.get<{ weekly_margin_interest: JQuantsMarginBalance[] }>(
      '/markets/weekly_margin_interest',
      { date: this.toDateStr(date) },
    );
    return data.weekly_margin_interest;
  }

  async fetchShortSellingPositions(date: Date): Promise<JQuantsShortSelling[]> {
    const data = await this.get<{ short_selling: JQuantsShortSelling[] }>(
      '/markets/short_selling',
      { date: this.toDateStr(date) },
    );
    return data.short_selling;
  }

  async fetchInvestorTypeTrading(date: Date): Promise<JQuantsInvestorTypeTrading[]> {
    const data = await this.get<{ trading_by_type: JQuantsInvestorTypeTrading[] }>(
      '/markets/trading_by_type',
      { date: this.toDateStr(date) },
    );
    return data.trading_by_type;
  }

  async fetchBulkCsv(datasetName: string, date?: Date): Promise<string> {
    if (this.isV2()) {
      throw new Error('JQuants bulk CSV download is not implemented for V2 yet');
    }
    const token = await this.getIdToken();
    const url = new URL(`${this.config.baseUrl}/files/download`);
    url.searchParams.set('dataset', datasetName);
    if (date) url.searchParams.set('date', this.toDateStr(date));
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`JQuants bulk CSV ${datasetName} -> ${res.status}`);
    return res.text();
  }

  private mapV2DailyQuote(row: JQuantsV2DailyQuote): JQuantsDailyQuote {
    return {
      Date: row.Date,
      Code: row.Code,
      Open: row.O,
      High: row.H,
      Low: row.L,
      Close: row.C,
      UpperLimit: row.UL,
      LowerLimit: row.LL,
      Volume: row.Vo,
      TurnoverValue: row.Va,
      AdjustmentFactor: row.AdjFactor,
      AdjustmentOpen: row.AdjO,
      AdjustmentHigh: row.AdjH,
      AdjustmentLow: row.AdjL,
      AdjustmentClose: row.AdjC,
      AdjustmentVolume: row.AdjVo,
    };
  }

  private mapV2IndexQuote(row: JQuantsV2DailyQuote): JQuantsIndexQuote {
    return {
      Date: row.Date,
      Code: row.Code,
      Open: row.O,
      High: row.H,
      Low: row.L,
      Close: row.C,
      Volume: row.Vo,
    };
  }

  private mapV2Statement(row: JQuantsV2Statement): JQuantsStatement {
    return {
      ...(row as unknown as JQuantsStatement),
      DisclosedDate: row.DiscDate ?? '',
      DisclosedTime: row.DiscTime ?? '',
      LocalCode: row.Code ?? '',
      DisclosureNumber: row.DiscNo ?? '',
      TypeOfDocument: row.DocType ?? '',
      TypeOfCurrentPeriod: row.CurPerType ?? '',
      CurrentPeriodStartDate: row.CurPerSt ?? '',
      CurrentPeriodEndDate: row.CurPerEn ?? '',
      CurrentFiscalYearStartDate: row.CurFYSt ?? '',
      CurrentFiscalYearEndDate: row.CurFYEn ?? '',
      NextFiscalYearStartDate: row.NxtFYSt ?? '',
      NextFiscalYearEndDate: row.NxtFYEn ?? '',
      NetSales: row.Sales ?? '',
      OperatingProfit: row.OP ?? '',
      OrdinaryProfit: row.OdP ?? '',
      Profit: row.NP ?? '',
      EarningsPerShare: row.EPS ?? '',
      DilutedEarningsPerShare: row.DEPS ?? '',
      TotalAssets: row.TA ?? '',
      Equity: row.Eq ?? '',
      EquityToAssetRatio: row.EqAR ?? '',
      BookValuePerShare: row.BPS ?? '',
      CashFlowsFromOperatingActivities: row.CFO ?? '',
      CashFlowsFromInvestingActivities: row.CFI ?? '',
      CashFlowsFromFinancingActivities: row.CFF ?? '',
      CashAndEquivalents: row.CashEq ?? '',
      ForecastNetSales: row.FSales ?? '',
      ForecastOperatingProfit: row.FOP ?? '',
      ForecastOrdinaryProfit: row.FOdP ?? '',
      ForecastProfit: row.FNP ?? '',
      ForecastEarningsPerShare: row.FEPS ?? '',
      ForecastNonConsolidatedNetSales: row.FNCSales ?? '',
      ForecastNonConsolidatedOperatingProfit: row.FNCOP ?? '',
      ForecastNonConsolidatedOrdinaryProfit: row.FNCOdP ?? '',
      ForecastNonConsolidatedProfit: row.FNCNP ?? '',
      ForecastNonConsolidatedEarningsPerShare: row.FNCEPS ?? '',
    };
  }
}

export function createJQuantsProvider(env: NodeJS.ProcessEnv = process.env): JQuantsProvider | null {
  const plan = (env.JQUANTS_PLAN ?? 'free') as 'free' | 'standard' | 'premium';
  const hasCredentials =
    env.JQUANTS_API_KEY ||
    (env.JQUANTS_EMAIL && env.JQUANTS_PASSWORD) ||
    env.JQUANTS_REFRESH_TOKEN ||
    env.JQUANTS_ID_TOKEN;

  if (!hasCredentials) return null;

  return new JQuantsProvider({
    baseUrl: env.JQUANTS_BASE_URL ?? (env.JQUANTS_API_KEY ? 'https://api.jquants.com/v2' : 'https://api.jquants.com/v1'),
    apiKey: env.JQUANTS_API_KEY,
    email: env.JQUANTS_EMAIL,
    password: env.JQUANTS_PASSWORD,
    refreshToken: env.JQUANTS_REFRESH_TOKEN,
    idToken: env.JQUANTS_ID_TOKEN,
    plan,
    enableAddons: env.JQUANTS_ENABLE_ADDONS === 'true',
  });
}
