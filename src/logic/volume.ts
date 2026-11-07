// 成交量 / 成交额合成与统计（纯函数，无副作用）
//
// 口径说明（1 回合 = 1 游戏小时）：
//  1. 单回合成交量 = 基础代币成交量（自然换手）+ 热度代币成交量（绝对资金增量）
//  2. 当回合成交额 = 单回合成交量 × 当回合 VWAP
//  3. 24h 成交量 = 最近 24 回合「成交量(代币)」求和
//     24h 成交额 = 最近 24 回合「当回合成交额(USDT)」求和
import type { Candle } from '../types';

/** 各 Tier 的基础每小时换手率：巨鲸最低，微型 Meme 最高 */
export const TIER_BASE_HOURLY_TURNOVER: Record<number, number> = {
  6: 0.0006, // 巨鲸
  5: 0.0012, // 巨型
  4: 0.0020, // 大型
  3: 0.0040, // 中型
  2: 0.0060, // 小型
  1: 0.0125, // 微型（Meme）
};

/** 涨跌放大系数：1 + |当回合涨跌幅| × 10 */
export const VOLATILITY_VOLUME_MULTIPLIER = 10;
/** 热度 100 时单回合带来的成交额（USDT） */
export const HEAT_NOTIONAL_AT_MAX = 30_000_000;
/** 安全锁：热度代币成交量最多为流通量的 3 倍 */
export const HEAT_VOLUME_CAP_RATIO = 3;

export function getTierBaseHourlyTurnover(tier: number): number {
  return TIER_BASE_HOURLY_TURNOVER[tier] ?? TIER_BASE_HOURLY_TURNOVER[1];
}

/** 当回合 VWAP：优先使用 K 线生成时记录的 vwap，历史 K 线回退到典型价 (H+L+C)/3 */
export function computeCandleVwap(candle: Pick<Candle, 'vwap' | 'high' | 'low' | 'close'>): number {
  if (typeof candle.vwap === 'number' && candle.vwap > 0) return candle.vwap;
  const close = candle.close || 0;
  const high = candle.high || close;
  const low = candle.low || close;
  const vwap = (high + low + close) / 3;
  return vwap > 0 ? vwap : close;
}

/** 当回合成交额（USDT） */
export function computeCandleTurnover(candle: Candle): number {
  if (!(candle.volume > 0)) return 0;
  if (typeof candle.turnover === 'number' && candle.turnover > 0) return candle.turnover;
  return candle.volume * computeCandleVwap(candle);
}

/** 最近 24 回合成交额（USDT） */
export function compute24hTurnover(candles: Candle[] | undefined | null): number {
  if (!Array.isArray(candles) || candles.length === 0) return 0;
  return candles.slice(-24).reduce((sum, c) => sum + computeCandleTurnover(c), 0);
}

/** 最近 24 回合成交量（代币数量） */
export function compute24hVolume(candles: Candle[] | undefined | null): number {
  if (!Array.isArray(candles) || candles.length === 0) return 0;
  return candles.slice(-24).reduce((sum, c) => sum + (c.volume || 0), 0);
}

export interface RoundVolumeInput {
  tier: number;
  circulatingSupply: number;
  /** 当回合涨跌幅（小数，如 0.03 表示 +3%） */
  roundChange: number;
  /** 当前热度 0-100 */
  heat: number;
  /** 当回合 VWAP（用于把热度资金额换算成代币数量） */
  vwap: number;
}

export interface RoundVolumeResult {
  /** 单回合成交量（代币数量） */
  volume: number;
  /** 基础代币成交量 */
  baseVolume: number;
  /** 热度代币成交量（已应用 3 倍流通量安全锁） */
  heatVolume: number;
  /** 热度资金增量（USDT，未换算成代币前） */
  heatNotional: number;
  /** 波动乘数 = 1 + |涨跌幅| × 10 */
  volatilityMultiplier: number;
  /** 当回合成交额（USDT） */
  turnover: number;
  vwap: number;
}

/**
 * 全新单回合成交量公式（纯合成，不依赖任何真实成交记录）：
 *   base = 流通量 × 基础每小时换手率(tier) × (1 + |当回合涨跌幅| × 10)
 *   heat = (热度 / 100) × 30,000,000 / VWAP，且不超过流通量 × 3
 *   volume = base + heat，turnover = volume × VWAP
 */
export function computeRoundVolume(input: RoundVolumeInput): RoundVolumeResult {
  const supply = Math.max(0, input.circulatingSupply || 0);
  const vwap = input.vwap > 0 ? input.vwap : 1;
  const baseRate = getTierBaseHourlyTurnover(input.tier);
  const roundChangeAbs = Math.abs(Number.isFinite(input.roundChange) ? input.roundChange : 0);
  const volatilityMultiplier = 1 + roundChangeAbs * VOLATILITY_VOLUME_MULTIPLIER;
  const baseVolume = supply * baseRate * volatilityMultiplier;

  const heatNotional = (Math.max(0, Math.min(100, input.heat)) / 100) * HEAT_NOTIONAL_AT_MAX;
  const heatVolumeRaw = heatNotional / vwap;
  const heatVolume = Math.min(heatVolumeRaw, supply * HEAT_VOLUME_CAP_RATIO);

  const volume = baseVolume + heatVolume;
  const turnover = volume * vwap;
  return { volume, baseVolume, heatVolume, heatNotional, volatilityMultiplier, turnover, vwap };
}
