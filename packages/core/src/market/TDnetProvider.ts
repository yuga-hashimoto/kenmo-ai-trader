/**
 * TDnet (東証 適時開示情報伝達サービス) provider.
 * TDnet API is commercial — disabled by default.
 * When TDNET_ENABLED=false or API key missing, falls back to SeedDisclosureProvider.
 * If J-Quants TDnet add-on is available, use JQuantsTDnetProvider.
 */

export type TDnetDocFileType = 'summary_pdf' | 'full_pdf' | 'xbrl';

export type TDnetDisclosureCategory =
  | 'earnings'
  | 'guidance_revision'
  | 'dividend_revision'
  | 'share_buyback'
  | 'midterm_plan'
  | 'pr_info'
  | 'other';

export interface TDnetDisclosureIndex {
  disclosureNumber: string;
  submittedAt: string;
  symbolCode: string;
  companyName: string;
  title: string;
  category: TDnetDisclosureCategory;
  pdfUrl?: string;
  xbrlUrl?: string;
}

export interface TDnetDocument {
  disclosureNumber: string;
  fileType: TDnetDocFileType;
  content: Buffer;
}

export interface TDnetProvider {
  fetchDisclosureIndex(from: Date, to: Date): Promise<TDnetDisclosureIndex[]>;
  fetchDisclosureDocument(
    disclosureNumber: string,
    fileType: TDnetDocFileType,
  ): Promise<TDnetDocument | null>;
  parseDisclosureText(document: Buffer | string): Promise<string>;
  classifyDisclosure(
    title: string,
    rawText?: string,
  ): TDnetDisclosureCategory;
}

export class SeedDisclosureProvider implements TDnetProvider {
  async fetchDisclosureIndex(_from: Date, _to: Date): Promise<TDnetDisclosureIndex[]> {
    return [];
  }

  async fetchDisclosureDocument(
    _disclosureNumber: string,
    _fileType: TDnetDocFileType,
  ): Promise<TDnetDocument | null> {
    return null;
  }

  async parseDisclosureText(document: Buffer | string): Promise<string> {
    return typeof document === 'string' ? document : document.toString('utf-8');
  }

  classifyDisclosure(title: string, _rawText?: string): TDnetDisclosureCategory {
    const t = title.toLowerCase();
    if (t.includes('決算') || t.includes('業績')) {
      if (t.includes('修正') || t.includes('変更')) return 'guidance_revision';
      return 'earnings';
    }
    if (t.includes('配当')) return 'dividend_revision';
    if (t.includes('自己株') || t.includes('自社株')) return 'share_buyback';
    if (t.includes('中期') || t.includes('経営計画')) return 'midterm_plan';
    return 'other';
  }
}

export class DisabledTDnetProvider implements TDnetProvider {
  async fetchDisclosureIndex(_from: Date, _to: Date): Promise<TDnetDisclosureIndex[]> {
    throw new Error('TDnet provider is disabled (set TDNET_ENABLED=true and configure TDNET_API_KEY)');
  }

  async fetchDisclosureDocument(
    _disclosureNumber: string,
    _fileType: TDnetDocFileType,
  ): Promise<TDnetDocument | null> {
    return null;
  }

  async parseDisclosureText(document: Buffer | string): Promise<string> {
    return typeof document === 'string' ? document : document.toString('utf-8');
  }

  classifyDisclosure(title: string, rawText?: string): TDnetDisclosureCategory {
    return new SeedDisclosureProvider().classifyDisclosure(title, rawText);
  }
}

export class HttpTDnetProvider implements TDnetProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async fetchJson<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      headers: { 'X-API-Key': this.apiKey },
    });
    if (!res.ok) throw new Error(`TDnet ${path} -> ${res.status}`);
    return res.json() as Promise<T>;
  }

  private toDateStr(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  async fetchDisclosureIndex(from: Date, to: Date): Promise<TDnetDisclosureIndex[]> {
    type Row = {
      disclosure_no: string;
      submitted_at: string;
      code: string;
      company_name: string;
      title: string;
      pdf_url?: string;
      xbrl_url?: string;
    };
    const data = await this.fetchJson<{ disclosures: Row[] }>('/disclosures', {
      from: this.toDateStr(from),
      to: this.toDateStr(to),
    });
    return data.disclosures.map((r) => ({
      disclosureNumber: r.disclosure_no,
      submittedAt: r.submitted_at,
      symbolCode: r.code,
      companyName: r.company_name,
      title: r.title,
      category: this.classifyDisclosure(r.title),
      pdfUrl: r.pdf_url,
      xbrlUrl: r.xbrl_url,
    }));
  }

  async fetchDisclosureDocument(
    disclosureNumber: string,
    fileType: TDnetDocFileType,
  ): Promise<TDnetDocument | null> {
    const url = new URL(`${this.baseUrl}/disclosures/${disclosureNumber}/document`);
    url.searchParams.set('type', fileType);
    const res = await fetch(url.toString(), {
      headers: { 'X-API-Key': this.apiKey },
    });
    if (!res.ok) return null;
    const content = Buffer.from(await res.arrayBuffer());
    return { disclosureNumber, fileType, content };
  }

  async parseDisclosureText(document: Buffer | string): Promise<string> {
    return typeof document === 'string' ? document : document.toString('utf-8');
  }

  classifyDisclosure(title: string, _rawText?: string): TDnetDisclosureCategory {
    return new SeedDisclosureProvider().classifyDisclosure(title, _rawText);
  }
}

/** J-Quants TDnet add-on provider (requires premium plan + add-on subscription). */
export class JQuantsTDnetProvider implements TDnetProvider {
  private readonly seed = new SeedDisclosureProvider();

  constructor(private readonly jquantsBaseUrl: string, private readonly idToken: string) {}

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.jquantsBaseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.idToken}` },
    });
    if (!res.ok) throw new Error(`JQuantsTDnet ${path} -> ${res.status}`);
    return res.json() as Promise<T>;
  }

  private toDateStr(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  async fetchDisclosureIndex(from: Date, to: Date): Promise<TDnetDisclosureIndex[]> {
    type Row = {
      DisclosureNumber: string;
      DisclosedDate: string;
      DisclosedTime: string;
      LocalCode: string;
      CompanyName: string;
      Title: string;
    };
    const data = await this.get<{ tdnet: Row[] }>('/markets/trades_spec', {
      from: this.toDateStr(from),
      to: this.toDateStr(to),
    });
    return (data.tdnet ?? []).map((r) => ({
      disclosureNumber: r.DisclosureNumber,
      submittedAt: `${r.DisclosedDate}T${r.DisclosedTime}+09:00`,
      symbolCode: r.LocalCode,
      companyName: r.CompanyName,
      title: r.Title,
      category: this.classifyDisclosure(r.Title),
    }));
  }

  async fetchDisclosureDocument(
    _disclosureNumber: string,
    _fileType: TDnetDocFileType,
  ): Promise<TDnetDocument | null> {
    return null;
  }

  parseDisclosureText = this.seed.parseDisclosureText.bind(this.seed);
  classifyDisclosure = this.seed.classifyDisclosure.bind(this.seed);
}

export class YanoshinTDnetProvider implements TDnetProvider {
  private readonly seed = new SeedDisclosureProvider();

  constructor() {}

  private toDateStr(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  async fetchDisclosureIndex(from: Date, to: Date): Promise<TDnetDisclosureIndex[]> {
    const results: TDnetDisclosureIndex[] = [];
    const cur = new Date(from.getTime());
    while (cur <= to) {
      const dateStr = this.toDateStr(cur);
      const url = `https://webapi.yanoshin.jp/webapi/tdnet/list/${dateStr}.json`;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json() as any[];
          if (Array.isArray(data)) {
            for (const item of data) {
              const td = item.Tdnet;
              if (!td) continue;
              
              const rawCode = String(td.company_code || '').trim();
              let code = rawCode;
              // Normalization to 5 digits ending with 0 if it is 4 digits
              if (code.length === 5 && code.endsWith('0')) {
                // Already JQuants format
              } else if (code.length === 4) {
                code = code + '0';
              }
              
              results.push({
                disclosureNumber: td.id,
                submittedAt: td.pubdate.replace(' ', 'T') + '+09:00',
                symbolCode: code,
                companyName: td.company_name,
                title: td.title,
                category: this.classifyDisclosure(td.title),
                pdfUrl: td.document_url,
              });
            }
          }
        }
      } catch (e) {
        console.warn(`[YanoshinTDnetProvider] Failed to fetch TDnet for ${dateStr}:`, String(e));
      }
      cur.setDate(cur.getDate() + 1);
    }
    return results;
  }

  async fetchDisclosureDocument(
    _disclosureNumber: string,
    _fileType: TDnetDocFileType,
  ): Promise<TDnetDocument | null> {
    return null; // document binary download not supported on free API
  }

  parseDisclosureText = this.seed.parseDisclosureText.bind(this.seed);
  classifyDisclosure = this.seed.classifyDisclosure.bind(this.seed);
}

export function createTDnetProvider(env: NodeJS.ProcessEnv = process.env): TDnetProvider {
  if (env.TDNET_ENABLED !== 'true') {
    return new YanoshinTDnetProvider();
  }
  if (!env.TDNET_API_KEY) {
    console.warn('TDNET_ENABLED=true but TDNET_API_KEY not set — falling back to YanoshinTDnetProvider');
    return new YanoshinTDnetProvider();
  }
  const baseUrl = env.TDNET_API_BASE_URL ?? '';
  if (!baseUrl) {
    console.warn('TDNET_API_BASE_URL not set — falling back to YanoshinTDnetProvider');
    return new YanoshinTDnetProvider();
  }
  return new HttpTDnetProvider(baseUrl, env.TDNET_API_KEY);
}
