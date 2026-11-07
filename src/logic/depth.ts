/**
 * 【盘口深度模型】统一现货与合约的「USDT 单边总深度」口径。
 *
 * 单边总深度（USDT）= 流通市值 × 0.02% + 5000U 固定底仓 + (热度/100) × 30万U
 * 单边总代币深度     = 单边总深度 / 价格
 * 各档按权重摊分：买盘 (1 + 0.12i / 0.15i)，卖盘 (1 + 0.15i / 0.2i)，i = 1..10
 *
 * 设计目标：盘口厚度由「绝对资金量」决定，热度对薄盘币影响显著、对厚盘币几乎无感；
 * 避免旧的「有效供应 × 百分比」在小市值/高持仓场景下盘口虚厚或骤然枯竭。
 */

/** 基础深度：流通市值的 0.02% */
export const SIDE_DEPTH_MARKET_CAP_RATIO = 0.0002;
/** 固定底仓（USDT）：防止极小市值代币盘口完全为空 */
export const SIDE_DEPTH_FIXED_USDT = 5000;
/** 满热度（100）时的单边绝对资金增量（USDT） */
export const SIDE_DEPTH_HEAT_USDT_MAX = 300000;
/** 每档地板：流通市值的 0.001% / 价格 */
export const LEVEL_FLOOR_MARKET_CAP_RATIO = 0.00001;

export interface SideDepthInput {
  circulatingSupply: number;
  totalSupply?: number;
  price: number;
  heat: number;
}

export interface SideDepthResult {
  /** 流通市值 = 流通量 × 价格 */
  marketCap: number;
  /** 基础深度（USDT） */
  baseDepthUsdt: number;
  /** 热度增量（USDT） */
  heatDepthUsdt: number;
  /** 单边总深度（USDT） */
  totalDepthUsdt: number;
  /** 单边总代币深度 */
  totalDepthTokens: number;
  /** 每档地板（代币数量） */
  floorTokens: number;
}

export function computeSideDepth(input: SideDepthInput): SideDepthResult {
  const circulatingSupply = Number.isFinite(input.circulatingSupply) && input.circulatingSupply > 0
    ? input.circulatingSupply
    : (Number.isFinite(input.totalSupply) && (input.totalSupply || 0) > 0 ? (input.totalSupply as number) : 1);
  const price = Number.isFinite(input.price) && input.price > 0 ? input.price : 0.0000001;
  const heat = Math.max(0, Math.min(100, Number.isFinite(input.heat) ? input.heat : 0));

  const marketCap = circulatingSupply * price;
  const baseDepthUsdt = marketCap * SIDE_DEPTH_MARKET_CAP_RATIO + SIDE_DEPTH_FIXED_USDT;
  const heatDepthUsdt = (heat / 100) * SIDE_DEPTH_HEAT_USDT_MAX;
  const totalDepthUsdt = baseDepthUsdt + heatDepthUsdt;
  const totalDepthTokens = totalDepthUsdt / price;
  const floorTokens = (marketCap * LEVEL_FLOOR_MARKET_CAP_RATIO) / price;

  return { marketCap, baseDepthUsdt, heatDepthUsdt, totalDepthUsdt, totalDepthTokens, floorTokens };
}

export interface LevelBasesResult {
  bidLevelBases: number[];
  askLevelBases: number[];
  bidWeightSum: number;
  askWeightSum: number;
}

/**
 * 把单边总代币深度按权重摊到 10 档：
 * 第 i 档权重 = 1 + step × i（i = 1..10），第 i 档量 = 总深度 × 权重 / 权重总和。
 */
export function computeWeightedLevelBases(
  totalDepthTokens: number,
  levelCount: number,
  bidStep: number,
  askStep: number,
): LevelBasesResult {
  const count = Math.max(1, Math.floor(levelCount));
  const bidWeights: number[] = [];
  const askWeights: number[] = [];
  for (let i = 1; i <= count; i++) {
    bidWeights.push(1 + bidStep * i);
    askWeights.push(1 + askStep * i);
  }
  const bidWeightSum = bidWeights.reduce((sum, w) => sum + w, 0);
  const askWeightSum = askWeights.reduce((sum, w) => sum + w, 0);
  const safeTotal = Number.isFinite(totalDepthTokens) && totalDepthTokens > 0 ? totalDepthTokens : 0;
  return {
    bidLevelBases: bidWeights.map(w => (safeTotal * w) / bidWeightSum),
    askLevelBases: askWeights.map(w => (safeTotal * w) / askWeightSum),
    bidWeightSum,
    askWeightSum,
  };
}
