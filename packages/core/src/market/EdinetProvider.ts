/**
 * EDINET (電子開示システム) provider.
 * EDINET API v2: https://disclosure2.edinet-fsa.go.jp/
 * Disabled by default. Falls back to no-op when EDINET_ENABLED=false or key missing.
 */

export type EdinetDocType = 'pdf' | 'xbrl' | 'csv';

export type EdinetDocCategory =
  | 'annual_securities_report'    // 有価証券報告書
  | 'semiannual_securities_report' // 半期報告書
  | 'quarterly_securities_report' // 四半期報告書
  | 'large_shareholding'          // 大量保有報告書
  | 'extraordinary_report'        // 臨時報告書
  | 'other';

export interface EdinetDocumentMeta {
  docId: string;
  edinetCode: string;
  secCode: string;
  filerName: string;
  docTypeCode: string;
  docDescription: string;
  submitDateTime: string;
  periodStart: string;
  periodEnd: string;
  pdfFlag: string;
  xbrlFlag: string;
  csvFlag: string;
}

export interface EdinetDocumentList {
  metadata: {
    title: string;
    parameter: { date: string; type: string };
    resultset: { count: number };
    processDateTime: string;
    status: string;
    message: string;
  };
  results: EdinetDocumentMeta[];
}

export interface EdinetLargeShareholding {
  holderName: string;
  shareholdingPct: number;
  sharesHeld: number;
  reportDate: string;
}

export class EdinetProvider {
  constructor(
    private readonly apiKey: string,
    // EDINET API v2 lives on api.edinet-fsa.go.jp; disclosure2.* is the web UI and
    // 302-redirects API calls to an error page.
    private readonly baseUrl: string = 'https://api.edinet-fsa.go.jp/api/v2',
  ) {}

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('Subscription-Key', this.apiKey);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`EDINET ${path} -> ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private toDateStr(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  async fetchDocumentList(date: Date): Promise<EdinetDocumentList> {
    return this.get<EdinetDocumentList>('/documents.json', {
      date: this.toDateStr(date),
      type: '2',
    });
  }

  async fetchDocument(docId: string, type: EdinetDocType): Promise<Buffer> {
    const typeMap: Record<EdinetDocType, string> = { pdf: '2', xbrl: '1', csv: '5' };
    const url = new URL(`${this.baseUrl}/documents/${docId}`);
    url.searchParams.set('Subscription-Key', this.apiKey);
    url.searchParams.set('type', typeMap[type]);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`EDINET document ${docId} type=${type} -> ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async fetchDocumentsByCode(code: string, from: Date, to: Date): Promise<EdinetDocumentMeta[]> {
    const results: EdinetDocumentMeta[] = [];
    const cur = new Date(from);
    while (cur <= to) {
      const list = await this.fetchDocumentList(cur);
      const matching = list.results.filter(
        (d) => d.secCode === code || d.secCode === `${code}0`,
      );
      results.push(...matching);
      cur.setDate(cur.getDate() + 1);
    }
    return results;
  }

  classifyEdinetDocument(docTypeCode: string): EdinetDocCategory {
    const map: Record<string, EdinetDocCategory> = {
      '120': 'annual_securities_report',
      '160': 'semiannual_securities_report',
      '140': 'quarterly_securities_report',
      '020': 'large_shareholding',
      '030': 'large_shareholding',
      '040': 'large_shareholding',
      '050': 'large_shareholding',
      '060': 'large_shareholding',
      '070': 'large_shareholding',
      '080': 'large_shareholding',
      '090': 'large_shareholding',
      '100': 'large_shareholding',
      '220': 'extraordinary_report',
    };
    return map[docTypeCode] ?? 'other';
  }

  async parseXbrlFinancials(file: Buffer): Promise<Record<string, string>> {
    // XBRL parsing requires an XML parser; return raw text map for now
    const text = file.toString('utf-8');
    const result: Record<string, string> = {};
    const matches = text.matchAll(/<[^>:]+:([^>]+)>([^<]+)<\/[^>]+>/g);
    for (const m of matches) {
      if (m[1] && m[2]) result[m[1]] = m[2];
    }
    return result;
  }

  async extractLargeShareholding(doc: Buffer | string): Promise<EdinetLargeShareholding[]> {
    const text = typeof doc === 'string' ? doc : doc.toString('utf-8');
    const results: EdinetLargeShareholding[] = [];
    const pctMatches = text.matchAll(/(\d+\.\d+)%/g);
    for (const m of pctMatches) {
      if (m[1]) {
        results.push({
          holderName: '(未解析)',
          shareholdingPct: Number(m[1]),
          sharesHeld: 0,
          reportDate: '',
        });
      }
    }
    return results;
  }
}

export class DisabledEdinetProvider {
  async fetchDocumentList(_date: Date): Promise<EdinetDocumentList> {
    return {
      metadata: {
        title: '',
        parameter: { date: '', type: '' },
        resultset: { count: 0 },
        processDateTime: '',
        status: '130',
        message: 'EDINET provider is disabled',
      },
      results: [],
    };
  }

  async fetchDocument(_docId: string, _type: EdinetDocType): Promise<Buffer> {
    return Buffer.alloc(0);
  }

  async fetchDocumentsByCode(_code: string, _from: Date, _to: Date): Promise<EdinetDocumentMeta[]> {
    return [];
  }

  classifyEdinetDocument(_docTypeCode: string): EdinetDocCategory {
    return 'other';
  }

  async parseXbrlFinancials(_file: Buffer): Promise<Record<string, string>> {
    return {};
  }

  async extractLargeShareholding(_doc: Buffer | string): Promise<EdinetLargeShareholding[]> {
    return [];
  }
}

export type AnyEdinetProvider = EdinetProvider | DisabledEdinetProvider;

export function createEdinetProvider(env: NodeJS.ProcessEnv = process.env): AnyEdinetProvider {
  if (env.EDINET_ENABLED !== 'true') return new DisabledEdinetProvider();
  if (!env.EDINET_API_KEY) {
    console.warn('EDINET_ENABLED=true but EDINET_API_KEY not set — disabled');
    return new DisabledEdinetProvider();
  }
  return new EdinetProvider(env.EDINET_API_KEY, env.EDINET_BASE_URL || undefined);
}
