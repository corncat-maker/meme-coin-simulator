// 【第五部分】CEX 库存量历史与抛压预警（纯函数，便于单测）
import type { CexReserveHistoryPoint } from '../types';

export type CexReserveRange = '24h' | '7d';

/** 展示区间：24 回合（1 天）/ 近 7 天（168 回合） */
export const CEX_RESERVE_RANGE_ROUNDS: Record<CexReserveRange, number> = {
  '24h': 24,
  '7d': 24 * 7,
};

/** 抛压判定基准：与 24 回合前比较 */
export const CEX_RESERVE_PRESSURE_ROUNDS = 24;
/** 库存增幅超过 100% 视为抛压风险 */
export const CEX_RESERVE_PRESSURE_THRESHOLD_RATIO = 1.0;

/** 取指定区间的库存序列（按回合升序） */
export function buildCexReserveSeries(
  history: CexReserveHistoryPoint[] | undefined,
  currentRound: number,
  range: CexReserveRange,
): CexReserveHistoryPoint[] {
  const windowRounds = CEX_RESERVE_RANGE_ROUNDS[range];
  const minRound = Math.max(0, currentRound - windowRounds + 1);
  return (history || [])
    .filter(point => Number.isFinite(point.round) && Number.isFinite(point.reserve)
      && point.round >= minRound && point.round <= currentRound)
    .sort((a, b) => a.round - b.round);
}

export interface CexReservePressure {
  shouldWarn: boolean;
  growthPercent: number;
  currentReserve: number;
  baseReserve: number;
  baseRound: number;
}

/**
 * 抛压预警：当前 CEX 库存较 24 回合前增加超过 100% 时触发。
 * 历史不足 24 回合时以最早一条记录为基准。
 */
export function computeCexReservePressure(
  history: CexReserveHistoryPoint[] | undefined,
  currentRound: number,
): CexReservePressure {
  const points = (history || [])
    .filter(point => Number.isFinite(point.round) && Number.isFinite(point.reserve) && point.round <= currentRound)
    .sort((a, b) => a.round - b.round);

  if (points.length === 0) {
    return { shouldWarn: false, growthPercent: 0, currentReserve: 0, baseReserve: 0, baseRound: currentRound };
  }

  const current = points[points.length - 1];
  const targetRound = currentRound - CEX_RESERVE_PRESSURE_ROUNDS;
  const base = points.find(point => point.round >= targetRound) ?? points[0];
  const growthPercent = base.reserve > 0
    ? ((current.reserve - base.reserve) / base.reserve) * 100
    : (current.reserve > 0 ? 100 : 0);

  return {
    shouldWarn: growthPercent > CEX_RESERVE_PRESSURE_THRESHOLD_RATIO * 100 && current.reserve > 0,
    growthPercent,
    currentReserve: current.reserve,
    baseReserve: base.reserve,
    baseRound: base.round,
  };
}
