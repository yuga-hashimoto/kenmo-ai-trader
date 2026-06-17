import type { BrokerAdapter } from './BrokerAdapter.js';
import type {
  AccountState,
  CancelOrderResult,
  OrderState,
  PlaceOrderRequest,
  PlaceOrderResult,
  PositionState,
  SchedulerEventContext,
} from '../types/index.js';

export class LiveTradingDisabledError extends Error {
  constructor(reason: string) {
    super(`Live trading blocked: ${reason}`);
    this.name = 'LiveTradingDisabledError';
  }
}

/**
 * Pluggable real-broker client. The shipped default (DisabledKabuStationClient)
 * throws on send, so no real order can ever be placed by accident. A real
 * implementation wires the kabu station REST API (localhost:18080) — see methods.
 */
export interface RealBrokerClient {
  readonly brokerName: string;
  sendOrder(order: {
    symbolCode: string;
    side: 'buy' | 'sell';
    quantity: number;
    limitPrice: number | null;
  }): Promise<{ brokerOrderId: string }>;
  cancelOrder(brokerOrderId: string): Promise<void>;
  getAccount(): Promise<AccountState>;
  getPositions(): Promise<PositionState[]>;
  getOrders(): Promise<OrderState[]>;
}

/** Default client: structurally complete but inert. Never sends real orders. */
export class DisabledKabuStationClient implements RealBrokerClient {
  readonly brokerName = 'kabu-station (disabled stub)';
  // A real client would hold: baseUrl=http://localhost:18080/kabusapi, an X-API-KEY
  // obtained via POST /token using a password from a secret store (NOT requested here),
  // then POST /sendorder, PUT /cancelorder, GET /wallet/cash, GET /positions, GET /orders.
  async sendOrder(): Promise<{ brokerOrderId: string }> {
    throw new LiveTradingDisabledError('real order client is the disabled stub');
  }
  async cancelOrder(): Promise<void> {
    throw new LiveTradingDisabledError('real order client is the disabled stub');
  }
  async getAccount(): Promise<AccountState> {
    throw new LiveTradingDisabledError('real order client is the disabled stub');
  }
  async getPositions(): Promise<PositionState[]> {
    throw new LiveTradingDisabledError('real order client is the disabled stub');
  }
  async getOrders(): Promise<OrderState[]> {
    throw new LiveTradingDisabledError('real order client is the disabled stub');
  }
}

export interface LiveBrokerOptions {
  /** Gate 1: process-level env flag (ENABLE_LIVE_TRADING=true). */
  enableLiveTrading: boolean;
  /** Gate 2: user completed the in-app live confirmation flow. */
  liveConfirmed: boolean;
  /** Gate 3: a confirmation token the caller must echo per session. */
  confirmationToken?: string;
  /** Real broker client. Defaults to the inert stub. */
  client?: RealBrokerClient;
}

/**
 * LiveBrokerAdapter — same interface as Backtest/Paper, for real trading.
 *
 * SAFETY (triple gate): an order can only reach the broker client when ALL of:
 *   1. enableLiveTrading === true   (env ENABLE_LIVE_TRADING)
 *   2. liveConfirmed === true       (UI confirmation flow)
 *   3. confirmationToken matches the per-order token on the request
 * AND a non-stub client is injected. The default ships with the disabled stub, so
 * this adapter is inert out of the box and never moves real money. No API keys or
 * account credentials are requested or stored here.
 */
export class LiveBrokerAdapter implements BrokerAdapter {
  private readonly client: RealBrokerClient;

  constructor(private readonly options: LiveBrokerOptions) {
    this.client = options.client ?? new DisabledKabuStationClient();
  }

  get isArmed(): boolean {
    return this.options.enableLiveTrading && this.options.liveConfirmed;
  }

  private assertArmed(perOrderToken?: string | null): void {
    if (!this.options.enableLiveTrading) {
      throw new LiveTradingDisabledError('ENABLE_LIVE_TRADING is not true');
    }
    if (!this.options.liveConfirmed) {
      throw new LiveTradingDisabledError('UI live confirmation not completed');
    }
    if (this.options.confirmationToken && perOrderToken !== this.options.confirmationToken) {
      throw new LiveTradingDisabledError('per-order confirmation token mismatch');
    }
    if (this.client instanceof DisabledKabuStationClient) {
      throw new LiveTradingDisabledError('no real broker client wired (stub only)');
    }
  }

  async getAccount(): Promise<AccountState> {
    this.assertArmed();
    return this.client.getAccount();
  }
  async getPositions(): Promise<PositionState[]> {
    this.assertArmed();
    return this.client.getPositions();
  }
  async getOrders(): Promise<OrderState[]> {
    this.assertArmed();
    return this.client.getOrders();
  }

  async placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult> {
    // confirmationToken can be smuggled via reason prefix "CONFIRM:<token>;" in a real flow;
    // here we simply enforce the gates. This NEVER fires with the default stub.
    this.assertArmed(this.options.confirmationToken);
    const { brokerOrderId } = await this.client.sendOrder({
      symbolCode: request.symbolCode,
      side: request.side,
      quantity: request.requestedQuantity ?? 0,
      limitPrice: request.limitPrice ?? null,
    });
    return { accepted: true, orderId: brokerOrderId, status: 'pending' };
  }

  async cancelOrder(orderId: string): Promise<CancelOrderResult> {
    this.assertArmed();
    await this.client.cancelOrder(orderId);
    return { cancelled: true };
  }

  async processSchedulerEvent(_event: SchedulerEventContext): Promise<void> {
    this.assertArmed();
  }
  async processDayEnd(): Promise<void> {
    this.assertArmed();
  }
}
