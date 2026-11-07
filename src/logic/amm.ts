// 从 src/App.tsx 机械搬迁（Stage 1），逻辑未改动。
import type { LiquidityPool, OrderBookEntry, Token } from '../types';
import { getTokenTier } from '../data/tokenMeta';

// ============ AMM流动性池函数 ============

/**
 * 初始化AMM流动性池
 * 根据代币当前价格和市值初始化池子储备
 * 【重要修复】流动性池中的代币储备量不能超过市场流通量的20%
 * 【关键修复】流动性池中的代币必须从流通量中分配，不能凭空生成
 * 【小市值代币修复】根据代币tier设置最小USDT储备量，确保流动性深度
 */
export function initializeLiquidityPool(
  token: Token,
  initialPrice: number
): LiquidityPool {
  // 【修复】流动性池中的代币储备量限制在市场流通量的10%-20%之间
  // 这确保了CEX盘口和DEX流动性池的代币总量不会超过市场流通量
  // 【关键】流动性池中的代币必须从流通量中分配，不能凭空生成
  // 因此我们使用较低的储备量比例（10%），避免过度占用流通量
  // 【宏观库存池】DEX 池代币储备必须与 token.dexReserve 物理库存一致；
  // 旧数据/未初始化时才回退到「流通量 10%-20%」的历史随机分配。
  const targetReserveRatio = 0.10 + Math.random() * 0.10; // 10%-20%（仅历史兜底）
  const tokenReserve = token.dexReserve > 0
    ? token.dexReserve
    : token.circulatingSupply * targetReserveRatio;
  
  // 根据价格计算USDT储备量
  // quoteReserve / tokenReserve = price => quoteReserve = tokenReserve * price
  let quoteReserve = tokenReserve * initialPrice;
  
  // 【小市值代币修复】根据代币tier设置最小USDT储备量
  // 确保低价代币有足够的流动性深度，防止微小资金推动价格剧烈波动
  const tier = getTokenTier(token);
  let minQuoteReserve = 1000; // 默认最小1000 USDT
  if (tier === 1) {
    // 微型代币：最小500 USDT
    minQuoteReserve = 500;
  } else if (tier === 2) {
    // 小型代币：最小1000 USDT
    minQuoteReserve = 1000;
  } else if (tier === 3) {
    // 中型代币：最小2000 USDT
    minQuoteReserve = 2000;
  } else {
    // 大型代币（tier 4-6）：最小5000 USDT
    minQuoteReserve = 5000;
  }
  
  // 如果计算出的quoteReserve小于最小值，使用最小值
  if (quoteReserve < minQuoteReserve) {
    quoteReserve = minQuoteReserve;
  }
  
  // 恒定乘积
  const k = tokenReserve * quoteReserve;
  
  // LP代币供应量（使用恒定乘积公式的标准计算方式）
  const lpTokenSupply = Math.sqrt(tokenReserve * quoteReserve);
  
  return {
    tokenId: token.id,
    tokenReserve,
    quoteReserve,
    k,
    fee: 0.003, // 0.3%手续费
    lpTokenSupply,
    lastPrice: initialPrice,
    priceImpact: 0.01, // 初始价格影响系数
  };
}

/**
 * AMM价格计算 - 恒定乘积公式 (x * y = k)
 * 计算买入一定数量代币需要的报价货币数量
 */
export function calculateAMMBuyPrice(
  pool: LiquidityPool,
  tokenAmount: number
): { quoteAmount: number; newPrice: number; priceImpact: number } {
  // 买入代币：quoteReserve增加，tokenReserve减少
  // dy = y * dx / (x - dx) * (1 + fee)
  // 其中 x = tokenReserve, y = quoteReserve, dx = tokenAmount
  const x = pool.tokenReserve;
  const y = pool.quoteReserve;
  const dx = tokenAmount;
  
  // 计算需要的报价货币数量（含手续费）
  const dy = y * dx / (x - dx) * (1 + pool.fee);
  
  // 计算新价格
  const newTokenReserve = x - dx;
  const newQuoteReserve = y + dy;
  const newPrice = newQuoteReserve / newTokenReserve;
  
  // 【修复】使用实际价格而不是lastPrice，避免因lastPrice不准确导致价格影响计算错误
  const currentPrice = pool.quoteReserve / pool.tokenReserve;
  const priceImpact = (newPrice - currentPrice) / currentPrice;
  
  return { quoteAmount: dy, newPrice, priceImpact };
}

/**
 * AMM价格计算 - 恒定乘积公式
 * 计算卖出一定数量代币获得的报价货币数量
 */
export function calculateAMMSellPrice(
  pool: LiquidityPool,
  tokenAmount: number
): { quoteAmount: number; newPrice: number; priceImpact: number } {
  // 卖出代币：tokenReserve增加，quoteReserve减少
  // dy = y * dx / (x + dx) * (1 - fee)
  const x = pool.tokenReserve;
  const y = pool.quoteReserve;
  const dx = tokenAmount;
  
  // 计算获得的报价货币数量（扣除手续费）
  const dy = y * dx / (x + dx) * (1 - pool.fee);
  
  // 计算新价格
  const newTokenReserve = x + dx;
  const newQuoteReserve = y - dy;
  const newPrice = newQuoteReserve / newTokenReserve;
  
  // 【修复】使用实际价格而不是lastPrice，避免因lastPrice不准确导致价格影响计算错误
  const currentPrice = pool.quoteReserve / pool.tokenReserve;
  const priceImpact = (currentPrice - newPrice) / currentPrice;
  
  return { quoteAmount: dy, newPrice, priceImpact };
}

/**
 * 从AMM流动性池生成虚拟盘口报价
 * 基于恒定乘积公式生成多档买盘和卖盘
 */
export function generateAMMQuoteLevels(
  pool: LiquidityPool,
  centerPrice: number,
  levels: number = 20,
  spacingBp: number = 10 // 价格间距（基点，1bp = 0.01%）
): { bids: OrderBookEntry[]; asks: OrderBookEntry[] } {
  const bids: OrderBookEntry[] = [];
  const asks: OrderBookEntry[] = [];
  
  // 计算价格间距
  const priceStep = centerPrice * spacingBp / 10000;
  
  // 生成买盘（价格低于中心价）
  for (let i = 0; i < levels; i++) {
    const price = centerPrice - priceStep * (i + 1);
    if (price <= 0) break;
    
    // 计算该价格对应的代币数量（模拟AMM曲线）
    // 买入量随价格下降递增（模拟流动性深度）
    const depthFactor = 1 + i * 0.15; // 深度递增因子
    const tokenAmount = pool.tokenReserve * 0.001 * depthFactor * (0.8 + Math.random() * 0.4);
    
    // 使用AMM公式计算实际可买入量
    const { quoteAmount } = calculateAMMBuyPrice(pool, tokenAmount);
    
    bids.push({
      price,
      quantity: tokenAmount,
      total: quoteAmount,
      isPlayer: false,
      isAMM: true, // 标记为AMM订单
    });
  }
  
  // 生成卖盘（价格高于中心价）
  for (let i = 0; i < levels; i++) {
    const price = centerPrice + priceStep * (i + 1);
    
    // 计算该价格对应的代币数量
    const depthFactor = 1 + i * 0.2; // 深度递增因子
    const tokenAmount = pool.tokenReserve * 0.001 * depthFactor * (0.8 + Math.random() * 0.4);
    
    // 使用AMM公式计算实际可卖出量
    const { quoteAmount } = calculateAMMSellPrice(pool, tokenAmount);
    
    asks.push({
      price,
      quantity: tokenAmount,
      total: quoteAmount,
      isPlayer: false,
      isAMM: true, // 标记为AMM订单
    });
  }
  
  return { bids, asks };
}

/**
 * 更新AMM流动性池状态（交易后）
 */
export function updateLiquidityPool(
  pool: LiquidityPool,
  side: 'buy' | 'sell',
  tokenAmount: number,
  quoteAmount: number
): LiquidityPool {
  const newPool = { ...pool };
  
  if (side === 'buy') {
    // 买入：代币减少，报价货币增加
    newPool.tokenReserve -= tokenAmount;
    newPool.quoteReserve += quoteAmount;
  } else {
    // 卖出：代币增加，报价货币减少
    newPool.tokenReserve += tokenAmount;
    newPool.quoteReserve -= quoteAmount;
  }
  
  // 更新恒定乘积
  newPool.k = newPool.tokenReserve * newPool.quoteReserve;
  
  // 更新价格
  newPool.lastPrice = newPool.quoteReserve / newPool.tokenReserve;
  
  return newPool;
}

/**
 * 同步流动性池与持仓状态
 * 
 * 【重要修复】移除主动调整流动性池的逻辑
 * 
 * 问题：之前的逻辑假设"玩家持仓增加 = 从流动性池买入"，但玩家可能在CEX交易。
 * 当玩家在CEX买入后，combinedHoldingRatio增加，触发该函数错误地减少tokenReserve，
 * 导致DEX价格暴涨（价格 = quoteReserve / tokenReserve）。
 * 
 * 修复：流动性池的代币储备应该只通过实际DEX交易来变化，而不是通过"同步"来调整。
 * 这个函数现在只更新lastPrice为CEX价格（保持价格同步），不再主动调整储备量。
 * 
 * @param pool 流动性池
 * @param combinedHoldingRatio 综合持仓占比（玩家 + AI持仓 / 流通量）
 * @param circulatingSupply 代币流通量
 * @param playerReservedRatio 玩家发行时自留代币比例（默认0）
 * @param marketMakerRatio 做市商分配比例（默认0）
 * @returns 调整后的流动性池（仅更新lastPrice）
 */
export function syncLiquidityPoolWithHoldings(
  pool: LiquidityPool,
  combinedHoldingRatio: number,
  circulatingSupply: number,
  playerReservedRatio: number = 0,
  marketMakerRatio: number = 0
): LiquidityPool {
  // 安全检查
  if (!pool || combinedHoldingRatio < 0 || combinedHoldingRatio > 1) {
    return pool;
  }
  
  // 【关键修复】流动性池的储备量应该只通过实际DEX交易和价格联动机制来变化
  // 这个函数不再主动调整tokenReserve，因为之前的逻辑会导致DEX价格暴涨
  // 价格同步由新的 dexPriceOffset 软联动机制负责（回合开始时重置池子）
  //
  // 【彻底移除30%阈值检查】
  // 之前的30%阈值检查会导致新发行代币的流动性池被强制调整
  // 例如：玩家分配25%流动性 + 做市商分配10% = 35% tokenReserve
  // 触发阈值后，tokenReserve被强制减少到30%，保持k不变导致quoteReserve增加
  // 结果：价格上涨约36%，这就是DEX价格暴涨的根本原因
  //
  // 流动性池的代币储备是玩家和做市商合法提供的，不应该被强制减少
  // 流动性池的变化应该只来自：
  // 1. 实际DEX交易（用户买入/卖出）
  // 2. CEX-DEX软联动（dexPriceOffset：回合开始时按目标价重置池子）
  // 3. 用户添加/移除流动性
  
  return pool;
}
