import type {
  AccountState,
  CancelOrderResult,
  OrderState,
  PlaceOrderRequest,
  PlaceOrderResult,
  PositionState,
  SchedulerEventContext,
} from '../types/index.js';

/**
 * The single Trade API the HermesAgent (and everything above it) is allowed to
 * use. The agent never touches a broker SDK or API key directly — it only calls
 * these methods. Concrete adapters: Backtest (in-memory sim), Paper (no real
 * orders), Live (disabled by default).
 */
export interface BrokerAdapter {
  getAccount(runId: string, atDate: Date): Promise<AccountState>;
  getPositions(runId: string, atDate: Date): Promise<PositionState[]>;
  getOrders(runId: string): Promise<OrderState[]>;
  placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult>;
  cancelOrder(orderId: string): Promise<CancelOrderResult>;
  processSchedulerEvent(event: SchedulerEventContext): Promise<void>;
  processDayEnd(runId: string, date: Date): Promise<void>;
}
