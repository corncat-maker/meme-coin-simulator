// 从 src/App.tsx 机械搬迁（Stage 1），逻辑未改动。
import type { Candle, DelistReason, LiquidityPool, Token } from '../types';
import { compute24hTurnover } from './volume';

// ============ 下架倒计时机制辅助函数 ============
// 判断代币是否处于下架倒计时中（已发下架通知，尚未正式下架）
export function isDelistPending(token: Token | undefined, currentRound: number): boolean {
  return !!token
    && !!token.delistScheduledRound
    && token.delistScheduledRound > currentRound
    && token.futuresListed !== false;
}

// 流动性不足下架阈值：近7日平均市值 < 300万
export const DELIST_LIQUIDITY_MIN_AVG_MARKET_CAP_7D = 3000000;
// 近7日 = 168回合（1日 = 24回合）
export const AVG_MARKET_CAP_7D_ROUNDS = 168;

// 计算代币近7日平均市值（用于流动性不足下架判断）
// 优先使用 marketCapHistory7d（168回合记录）；旧存档缺失时回退到 marketCapHistory（24回合）平均；
// 仍无记录时使用当前市值作为近似
export function computeAvgMarketCap7d(token: Token | undefined | null): number {
  if (!token) return 0;
  const history7d = token.marketCapHistory7d || [];
  if (history7d.length > 0) {
    return history7d.reduce((sum, h) => sum + (h.marketCap || 0), 0) / history7d.length;
  }
  const history24h = token.marketCapHistory || [];
  if (history24h.length > 0) {
    return history24h.reduce((sum, h) => sum + (h.marketCap || 0), 0) / history24h.length;
  }
  return token.marketCap || 0;
}

// 判断代币本回合是否触发下架条件（返回下架原因，未触发返回null）
// 与快进流程中的下架检测条件保持一致，用于预计算"本回合新发出下架公告"的代币集合
export function getDelistTriggerReason(
  token: Token,
  pool: LiquidityPool,
  maxHolderPercent: number,
  maxSingleHolderPercent: number,
  currentRound: number
): DelistReason | null {
  const isBTCorETH = token.code === 'BTC' || token.code === 'ETH';
  // 条件1：流动性不足下架（近7日平均市值 < 3M）
  if (computeAvgMarketCap7d(token) < DELIST_LIQUIDITY_MIN_AVG_MARKET_CAP_7D) return 'liquidity';
  // 条件2：操纵嫌疑下架（除BTC/ETH）
  if (!isBTCorETH) {
    // 观察标签代币：玩家或某交易员、做市商单人持仓超过总供应量90%即以操纵嫌疑下架
    const isWatchedToken = token.watchEndRound !== undefined && token.watchEndRound !== null && token.watchEndRound > currentRound;
    if (isWatchedToken && maxSingleHolderPercent > 0.9) return 'manipulation';
    const liquidationAmount24h = token.liquidationAmount24h || 0;
    const marketCapHistory = token.marketCapHistory || [];
    if (marketCapHistory.length >= 2) {
      const marketCaps = marketCapHistory.map(h => h.marketCap);
      const maxMarketCap = Math.max(...marketCaps);
      const minMarketCap = Math.min(...marketCaps);
      const marketCapFluctuation = maxMarketCap - minMarketCap;
      // 合并条件：强平金额 > 5B 且 市值波动 > 10B 且 单一持币者 > 50%
      if (liquidationAmount24h > 5000000000 && marketCapFluctuation > 10000000000 && maxHolderPercent > 0.5) return 'manipulation';
    }
  }
  // 条件3：诈骗嫌疑下架（24h跌幅 > 90% 且 流动性池USDT < 初始流动性的10%）
  const priceChange24h = token.change24h;
  const initialLiquidityUsdt = token.initialLiquidityUsdt || pool.quoteReserve;
  if (priceChange24h < -90 && initialLiquidityUsdt > 0 && pool.quoteReserve < initialLiquidityUsdt * 0.1) return 'fraud';
  return null;
}

// 下架原因文案
export function getDelistReasonText(reason: string): string {
  const map: Record<string, string> = {
    'liquidity': '流动性不足',
    'manipulation': '操纵嫌疑',
    'fraud': '诈骗嫌疑',
    'dev': '开发者指定',
  };
  return map[reason] || reason;
}

// 回合数转时间显示（模块级，用于下架通知与公告）
export function roundToTime(round: number): string {
  const day = Math.floor(round / 24) + 1;
  const hour = round % 24;
  return `第${day}天 ${hour.toString().padStart(2, '0')}:00`;
}

// ============ 合约上架标准（初始化/发行时判断） ============
// 代币必须同时满足：市值≥10M、DEX流动性池内USDT储备≥1M、24小时成交额≥1M（成交金额，不是成交数量）
export const LISTING_MIN_MARKET_CAP = 10000000; // 市值 ≥ 1000万
export const LISTING_MIN_QUOTE_RESERVE = 1000000; // DEX流动性池USDT储备 ≥ 100万
export const LISTING_MIN_TURNOVER_24H = 100000; // 24小时成交额 ≥ 10万（新版成交量口径更贴近真实，门槛同步下调）
export function canListFutures(marketCap: number, quoteReserve: number, turnover24h: number): boolean {
  return marketCap >= LISTING_MIN_MARKET_CAP
    && quoteReserve >= LISTING_MIN_QUOTE_RESERVE
    && turnover24h >= LISTING_MIN_TURNOVER_24H;
}
// 计算最近24根K线的成交额（优先使用 K 线记录的成交额字段，历史数据回退 VWAP 计算）
export function computeToken24hTurnover(candles: Candle[] | undefined | null): number {
  return compute24hTurnover(candles);
}
