/**
 * 行情/订单 Store（Stage 3 · 第三批次 · 第二批）
 *
 * 八个高频 slice 的唯一权威数据源：tokens / K线 / 现货盘口 / 合约盘口 /
 * 现货持仓 / 合约持仓 / 现货订单 / 合约订单。
 *
 * 提交策略：写入先进 pending buffer，同一 microtask tick 内所有写入合并为
 * 一次 store.setState（即一次订阅通知、一次 App 渲染）。
 */
import { useCallback, useSyncExternalStore } from 'react';
import { createStore } from 'zustand/vanilla';
import type {
  Candle, CexReserveHistoryPoint, FuturesOrder, FuturesOrderBook, FuturesPosition, Level2OrderBook, Order, Position, Token,
} from '../types';

/** 价格闪烁（盘口专用视觉状态，不参与业务计算） */
export interface PriceFlash {
  dir: 'up' | 'down';
  tick: number;
}

export interface MarketState {
  tokens: Token[];
  tokenCandlesMap: Record<string, Candle[]>;
  tokenOrderBookMap: Record<string, Level2OrderBook>;
  futuresOrderBookMap: Record<string, FuturesOrderBook>;
  positions: Position[];
  futuresPositions: FuturesPosition[];
  orders: Order[];
  futuresOrders: FuturesOrder[];
  priceFlash: PriceFlash | null;
  cexReserveHistory: Record<string, CexReserveHistoryPoint[]>;
}

const EMPTY_STATE: MarketState = {
  tokens: [],
  tokenCandlesMap: {},
  tokenOrderBookMap: {},
  futuresOrderBookMap: {},
  positions: [],
  futuresPositions: [],
  orders: [],
  futuresOrders: [],
  priceFlash: null,
  cexReserveHistory: {},
};

export const marketStore = createStore<MarketState>(() => ({ ...EMPTY_STATE }));

/** DEV 诊断：提交次数与每个 slice 的写入次数 */
export const marketCommitStats = {
  commits: 0,
  keys: 0,
  writes: {} as Record<string, number>,
};

let pendingPatch: Partial<MarketState> = {};
let flushScheduled = false;

function flushPending(): void {
  const patch = pendingPatch;
  const keys = Object.keys(patch);
  pendingPatch = {};
  flushScheduled = false;
  if (keys.length === 0) return;
  marketCommitStats.commits += 1;
  marketCommitStats.keys += keys.length;
  marketStore.setState(patch as MarketState);
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flushPending);
}

/**
 * 读取「本 tick 最新」的值：pending 优先，保证同一 tick 内连续的函数式更新
 * 与 React 的队列更新语义一致。
 */
export function readMarket<K extends keyof MarketState>(key: K): MarketState[K] {
  if (key in pendingPatch) return pendingPatch[key] as MarketState[K];
  return marketStore.getState()[key];
}

/** 写入（函数式更新基于 readMarket），同一 tick 合并提交 */
export function writeMarket<K extends keyof MarketState>(
  key: K,
  next: MarketState[K] | ((prev: MarketState[K]) => MarketState[K]),
): void {
  const computed = typeof next === 'function'
    ? (next as (prev: MarketState[K]) => MarketState[K])(readMarket(key))
    : next;
  pendingPatch[key] = computed;
  marketCommitStats.writes[key] = (marketCommitStats.writes[key] || 0) + 1;
  if (!flushScheduled) marketCommitStats.writes[`${key}#flush`] = (marketCommitStats.writes[`${key}#flush`] || 0) + 1;
  scheduleFlush();
}

/** 显式一次性提交一批 slice（读档、重开等需要立刻生效的场景） */
export function commitMarketRound(patch: Partial<MarketState>): void {
  Object.assign(pendingPatch, patch);
  Object.keys(patch).forEach((k) => {
    marketCommitStats.writes[k] = (marketCommitStats.writes[k] || 0) + 1;
  });
  scheduleFlush();
}

/** 读档 / 重开时重置 store */
export function resetMarketStore(): void {
  pendingPatch = {};
  marketStore.setState({ ...EMPTY_STATE });
}

function subscribe(onChange: () => void): () => void {
  return marketStore.subscribe(onChange);
}

/** 订阅单个 slice */
export function useMarketValue<K extends keyof MarketState>(key: K): MarketState[K] {
  const getSnapshot = useCallback(() => marketStore.getState()[key], [key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 取得稳定引用的 setter（等价于旧的 useState setter） */
export function useMarketSetter<K extends keyof MarketState>(
  key: K,
): (next: MarketState[K] | ((prev: MarketState[K]) => MarketState[K])) => void {
  return useCallback((next) => writeMarket(key, next), [key]);
}

/** [值, setter]，可直接替换 useState */
export function useMarketState<K extends keyof MarketState>(
  key: K,
): [MarketState[K], (next: MarketState[K] | ((prev: MarketState[K]) => MarketState[K])) => void] {
  return [useMarketValue(key), useMarketSetter(key)];
}

export function useMarketSelector<T>(selector: (state: MarketState) => T): T {
  const getSnapshot = useCallback(() => selector(marketStore.getState()), [selector]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const selectTokens = (s: MarketState) => s.tokens;
export const selectTokenCandlesMap = (s: MarketState) => s.tokenCandlesMap;
export const selectTokenOrderBookMap = (s: MarketState) => s.tokenOrderBookMap;
export const selectFuturesOrderBookMap = (s: MarketState) => s.futuresOrderBookMap;
export const selectPositions = (s: MarketState) => s.positions;
export const selectFuturesPositions = (s: MarketState) => s.futuresPositions;
export const selectOrders = (s: MarketState) => s.orders;
export const selectFuturesOrders = (s: MarketState) => s.futuresOrders;
export const selectPriceFlash = (s: MarketState) => s.priceFlash;
export const selectCexReserveHistory = (s: MarketState) => s.cexReserveHistory;
