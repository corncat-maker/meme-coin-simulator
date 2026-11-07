/**
 * 【初始盘口统一】开局 / 读档 / 回退 / 新币上架时生成的盘口，
 * 必须与回合滚动生成的盘口（generateNextPeriodOrderBook / 回合内 generateFuturesOrderBook）同口径：
 * 同一个 USDT 单边总深度模型、同一套档位权重、同一套缩放与地板。
 *
 * 本模块只做「参数装配」，不引入任何新公式。
 */
import type { Candle, FuturesOrderBook, Level2OrderBook, Token } from '../types';
import { generateLevel2OrderBook } from './orderbook';
import { generateFuturesOrderBook } from './futures';

export interface InitialSpotBookOptions {
  /** 热度（0-100），与回合滚动生成保持一致 */
  heat?: number;
  /** 玩家持仓数量（代币） */
  playerHoldings?: number;
  /** 盘口订单量缩放（观察标签 0.5） */
  orderScale?: number;
  /** 买盘独立缩放（即将下架 0.5） */
  bidScale?: number;
  /** 卖盘独立缩放（即将下架 2） */
  askScale?: number;
  /** 波动率乘数（默认 1） */
  volatility?: number;
}

/** 生成现货初始盘口（统一深度模型） */
export function createInitialSpotBook(
  token: Token,
  candle: Candle,
  options: InitialSpotBookOptions = {},
): Level2OrderBook {
  return generateLevel2OrderBook(
    token,
    candle,
    options.volatility ?? 1,
    options.playerHoldings ?? 0,
    0,
    0,
    options.orderScale ?? 1,
    options.heat ?? 0,
    options.bidScale ?? 1,
    options.askScale ?? 1,
  );
}

export interface InitialFuturesBookOptions {
  /** 热度（0-100） */
  heat?: number;
  /** 标记价格；不传则从现货盘口推导 */
  markPrice?: number;
  /** 资金费率套利系数 */
  fundingRateMultiplier?: number;
  /** 合约盘口订单量缩放（观察/下架/收缩 各 0.5） */
  orderScale?: number;
  playerHoldingRatio?: number;
  aiHoldingRatio?: number;
  marketMakerHoldingRatio?: number;
  playerReservedRatio?: number;
  marketingEffect?: 'fomo' | 'panic' | null;
  cumulativeChange?: number;
}

/** 现货盘口 → 标记价格（现货买一价，无买盘时回退卖一价 / 现价 0.998） */
export function resolveSpotMarkPrice(spotBook: Level2OrderBook | null | undefined, token: Token): number {
  const bid = spotBook?.bids?.[0]?.price || 0;
  const ask = spotBook?.asks?.[0]?.price || 0;
  const fallback = token.currentPrice * 0.998;
  return Math.max(0.0000001, bid > 0 ? bid : (ask > 0 ? ask : fallback));
}

/** 生成合约初始盘口（统一深度模型 + 现货盘口软联动） */
export function createInitialFuturesBook(
  token: Token,
  spotBook: Level2OrderBook | null | undefined,
  options: InitialFuturesBookOptions = {},
): FuturesOrderBook {
  const markPrice = options.markPrice && options.markPrice > 0
    ? options.markPrice
    : resolveSpotMarkPrice(spotBook, token);
  return generateFuturesOrderBook(
    token,
    markPrice,
    null,
    options.fundingRateMultiplier ?? 0,
    markPrice,
    options.marketingEffect ?? null,
    options.cumulativeChange ?? 0,
    options.playerHoldingRatio ?? 0,
    options.aiHoldingRatio ?? 0,
    options.marketMakerHoldingRatio ?? 0,
    options.orderScale ?? 1,
    spotBook ?? null,
    options.heat ?? 0,
    options.playerReservedRatio ?? 0,
  );
}
