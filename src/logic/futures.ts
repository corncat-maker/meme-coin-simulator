// 从 src/App.tsx 机械搬迁（Stage 1），逻辑未改动。
import type { AIFuturesPosition, FuturesOrderBook, FuturesPosition, Level2OrderBook, OrderBookEntry, RetailPosition, Token } from '../types';
import { getTokenTier } from '../data/tokenMeta';
import { computeSideDepth, computeWeightedLevelBases } from './depth';

// ============ 永续合约工具函数 ============

/**
 * 计算强平价格
 * @param side 方向 'long' | 'short'
 * @param entryPrice 开仓价格
 * @param leverage 杠杆倍数
 * @param maintenanceMarginRate 维持保证金率（默认0.5%）
 */
export function calculateLiquidationPrice(
  side: 'long' | 'short',
  entryPrice: number,
  leverage: number,
  maintenanceMarginRate: number = 0.005
): number {
  if (side === 'long') {
    // 1x杠杆做多时，保证金 = 仓位价值，价格跌到0才亏光全部保证金，强平价格为0
    if (leverage <= 1) return 0;
    // 做多强平价格 = 开仓价格 * (1 - 1/杠杆 + 维持保证金率)
    return entryPrice * (1 - 1 / leverage + maintenanceMarginRate);
  } else {
    // 做空强平价格 = 开仓价格 * (1 + 1/杠杆 - 维持保证金率)
    return entryPrice * (1 + 1 / leverage - maintenanceMarginRate);
  }
}

/**
 * 计算全仓模式强平价格
 * 全仓模式下，玩家的全部现金资产（可用现金 + 冻结现金 + 其他仓位浮盈）都作为保证金池
 * 强平价格 = 开仓价格 * (1 - 保证金池 / 仓位价值)（多仓）
 * 强平价格 = 开仓价格 * (1 + 保证金池 / 仓位价值)（空仓）
 * 当保证金池 >= 仓位价值时（做多），强平价格为0
 * @param side 方向 'long' | 'short'
 * @param entryPrice 开仓价格
 * @param totalMarginPool 总保证金池（可用现金 + 冻结现金 + 其他仓位正浮盈）
 * @param positionValue 仓位价值（开仓金额）
 */
export function calculateCrossLiquidationPrice(
  side: 'long' | 'short',
  entryPrice: number,
  totalMarginPool: number,
  positionValue: number
): number {
  if (positionValue <= 0 || totalMarginPool <= 0) {
    // 没有保证金池时，多仓强平价0，空仓强平价理论无穷大（用超大值近似）
    return side === 'long' ? 0 : entryPrice * 1e6;
  }
  if (side === 'long') {
    // 保证金池 >= 仓位价值时，价格跌到0才亏光，强平价格为0
    return Math.max(0, entryPrice * (1 - totalMarginPool / positionValue));
  } else {
    // 做空：价格涨到开仓价格 * (1 + 保证金池/仓位价值)时亏光
    return entryPrice * (1 + totalMarginPool / positionValue);
  }
}

/**
 * 计算止盈价格
 * 止盈目标与强平价格形成盈亏比，在1:2到1:100之间随机
 * @param side 方向 'long' | 'short'
 * @param entryPrice 开仓价格
 * @param liquidationPrice 强平价格
 */
export function calculateTakeProfitPrice(
  side: 'long' | 'short',
  entryPrice: number,
  liquidationPrice: number
): number {
  // 盈亏比在1:2到1:100之间随机
  const riskRewardRatio = 2 + Math.random() * 98; // 2到100
  
  if (side === 'long') {
    // 多单：止盈价格 = 开仓价格 + (开仓价格 - 强平价格) * 盈亏比
    const risk = entryPrice - liquidationPrice;
    return entryPrice + risk * riskRewardRatio;
  } else {
    // 空单：止盈价格 = 开仓价格 - (强平价格 - 开仓价格) * 盈亏比
    const risk = liquidationPrice - entryPrice;
    return entryPrice - risk * riskRewardRatio;
  }
}

/**
 * 资金费率结算配置（按代币tier）
 * 巨鲸：8小时一收，上限±0.1%；巨型：8小时一收，上限±0.5%
 * 大型：4小时一收，上限±0.5%；中型：4小时一收，上限±2%
 * 小型：1小时一收，上限±0.5%；微型：1小时一收（不变，上限±2%）
 */
export function getFundingConfig(tier: number): { interval: number; maxRate: number } {
  switch (tier) {
    case 6: return { interval: 8, maxRate: 0.001 }; // 巨鲸
    case 5: return { interval: 8, maxRate: 0.005 }; // 巨型
    case 4: return { interval: 4, maxRate: 0.005 }; // 大型
    case 3: return { interval: 4, maxRate: 0.02 };  // 中型
    case 2: return { interval: 1, maxRate: 0.005 }; // 小型
    default: return { interval: 1, maxRate: 0.02 }; // 微型（不变）
  }
}

/**
 * 新开局散户合约的单边名义持仓比例。
 *
 * 参考历史 BTC 期货 OI 的数百亿美元数量级，采用保守的游戏开局参数，
 * 并非实时市场数据：巨鲸币每边 1.5%，多空总敞口 3%，随市值层级递减。
 * 交易所 OI 通常只计一边；本游戏持仓量图仍展示多空总敞口，两者不可混称。
 * 不再将 DEX 池的 quoteReserve 加入开局合约仓位，避免巨大模拟现货池放大 OI。
 */
export function getInitialRetailSideOpenInterestRatio(tier: number): number {
  switch (tier) {
    case 6: return 0.015; // 巨鲸：多空合计约 3%，接近 BTC 级别
    case 5: return 0.012; // 巨型：多空合计约 2.4%
    case 4: return 0.008; // 大型：多空合计约 1.6%
    case 3: return 0.006; // 中型：多空合计约 1.2%
    case 2: return 0.004; // 小型：多空合计约 0.8%
    default: return 0.003; // 微型：多空合计约 0.6%
  }
}

/**
 * 计算资金费率
 * 资金费率 = 基差 / 现货价格 = (永续价格 - 现货价格) / 现货价格
 * 费率上限按代币tier配置（默认±2%）
 */
export function calculateFundingRate(futuresPrice: number, spotPrice: number, maxRate: number = 0.02): number {
  if (spotPrice <= 0) return 0;
  const rawRate = (futuresPrice - spotPrice) / spotPrice;
  return Math.max(-maxRate, Math.min(maxRate, rawRate));
}

/**
 * 计算某代币本次资金费率结算费率
 * 费率 = 过去N小时平均基差（N由tier的结算周期决定），并按tier上限截断
 */
export function calculateSettlementFundingRate(token: Token, basisHistory: Record<string, number[]>): number {
  const cfg = getFundingConfig(getTokenTier(token));
  const history = Array.isArray(basisHistory[token.id]) ? basisHistory[token.id] : [];
  const recent = history.slice(-cfg.interval);
  if (recent.length === 0) return 0;
  const avgBasis = recent.reduce((sum, b) => sum + b, 0) / recent.length;
  return Math.max(-cfg.maxRate, Math.min(cfg.maxRate, avgBasis));
}

/**
 * 生成永续合约订单簿（完全独立生成，不依赖现货订单簿）
 * 订单量是现货的3倍（以代币数量计）
 * 套利机制：当资金费率为正时，卖盘增加；当资金费率为负时，买盘增加
 * 
 * 重要：合约订单簿基于标记价格（现货买一价与合约买一价的几何平均数）生成，而非合约lastPrice
 * @param markPrice 标记价格（现货买一价与合约买一价的几何平均数），用于生成订单价格
 * 
 * 【有效市值机制】
 * 盘口生成的订单数量根据有效市值计算，而非总市值
 * 有效市值 = 总市值 * (1 - 玩家持仓占比 - AI交易员持仓占比 - 做市商持仓占比 - DEX流动性池内代币占比)
 * 例如：总量100M，价格1，市值100M，玩家持仓20%，AI交易员10%，做市商10%，DEX池30%
 * 则有效市值 = 100M * (1 - 20% - 10% - 10% - 30%) = 30M
 */
export function generateFuturesOrderBook(
  token: Token,
  currentPrice: number,
  existingBook: FuturesOrderBook | null = null,
  fundingRateMultiplier: number = 0, // 资金费率套利系数，正费率增加卖盘，负费率增加买盘
  markPrice?: number, // 标记价格（现货买一价与合约买一价的几何平均数），如果提供则使用此价格生成订单
  marketingEffect: 'fomo' | 'panic' | null = null, // 营销效果：FOMO增加买单，恐慌增加卖单
  cumulativeChange: number = 0, // 累计涨跌幅（连续上涨/下跌时从起始价格到当前价格的总涨跌幅），用于影响下回合盘口生成
  playerHoldingRatio: number = 0, // 玩家持仓占比（用于有效市值计算）
  aiHoldingRatio: number = 0, // AI交易员持仓占比（用于有效市值计算）
  marketMakerHoldingRatio: number = 0, // 做市商持仓占比（用于有效市值计算）
  orderScale: number = 1, // 盘口订单量缩放系数（观察标签代币为0.5，合约盘口订单生成减少50%）
  spotBook: Level2OrderBook | null = null, // 现货订单簿（用于合约-现货盘口联动锚定）
  heat: number = 50, // 热度（0-100），与现货盘口共用同一热度系数，保证两个市场盘口量级一致
  playerReservedRatio: number = 0 // 玩家自留代币占流通量比例（用于有效市值计算，与现货一致扣除自留）
): FuturesOrderBook {
  // 合约订单簿与现货订单簿软联动：以现货盘口最优买卖价中值为锚，保留资金费率基差
  const multiplier = 3; // 合约订单量是现货的3倍
  
  // ========== 合约盘口深度模型：USDT 单边总深度 → 每档挂单量 ==========
  // 说明：本节只影响「合约盘口每档挂单量」的生成口径，
  // 不改动全局「有效市值 / 有效供应」概念（现货盘口、持仓占比、流动性判定等逻辑保持原样）。
  //
  // 单边总深度（USDT）= 流通市值 × 0.02% + 5000U 底仓 + (热度/100) × 30万U
  const circulatingForDepth = token.circulatingSupply > 0
    ? token.circulatingSupply
    : (token.totalSupply > 0 ? token.totalSupply : 1);
  const depthPrice = currentPrice > 0 ? currentPrice : token.currentPrice;
  const sideDepth = computeSideDepth({
    circulatingSupply: circulatingForDepth,
    totalSupply: token.totalSupply,
    price: depthPrice,
    heat,
  });

  // 10 档权重分配（买：1+0.15i，卖：1+0.2i，i = 1..10），按权重把单边总深度摊到各档
  const LEVEL_COUNT = 10;
  const { bidLevelBases, askLevelBases } = computeWeightedLevelBases(
    sideDepth.totalDepthTokens,
    LEVEL_COUNT,
    0.15,
    0.2,
  );
  // 资金费率套利吃单量基准：买一档基础量
  const baseOrderQuantity = bidLevelBases[0] || 0;
  // 每档地板：市值的 0.001% / 价格（防止极低热度/极高持仓时盘口断档）
  const minLevelQuantity = Math.max(0.000001, sideDepth.floorTokens);

  // 盘口深度与现货一致
  const baseDepth = 10;
  
  // 根据市值确定订单深度百分比（与现货一致）
  let depthPercent = 0.03;
  if (token.marketCap > 500000000) depthPercent = 0.01;
  else if (token.marketCap > 100000000) depthPercent = 0.02;
  else if (token.marketCap < 1000000) depthPercent = 0.05;
  
  // 关键修复：使用currentPrice（吃单后的实时价格）作为订单生成的基准价格
  // markPrice 仅用于计算资金费率和作为标记价格
  const basePrice = currentPrice > 0 ? currentPrice : (markPrice && markPrice > 0 ? markPrice : token.currentPrice);
  
  // ========== 套利机制调整（指数级增强版）============
  // 资金费率影响买卖盘数量
  // 正费率：套利者做空合约、买入现货，合约卖盘增加，现货买盘增加
  // 负费率：套利者做多合约、卖出现货，合约买盘增加，现货卖盘增加
  // fundingRateMultiplier 范围通常在 -0.05 到 0.05 之间（±5%上限）
  // 
  // 关键增强：当资金费率达到±1%以上时，套利强度呈指数级增长
  // 套利机制仅在资金费率存在时生效
  const arbitrageMultiplier = Math.abs(fundingRateMultiplier);
  
  // 合约市场套利调整
  let futuresBidMultiplier = 1; // 合约买盘系数
  let futuresAskMultiplier = 1; // 合约卖盘系数
  
  // ========== 指数级套利强度计算 ============
  // 当资金费率 < 1% 时：线性增长
  // 当资金费率 >= 1% 时：指数级增长
  // 公式：强度 = 基础系数 * (1 + (费率 - 1%) * 指数因子)
  // 指数因子：费率每增加1%，强度翻倍
  let ARBITRAGE_AMPLIFICATION = 0;
  let ARBITRAGE_EAT_FACTOR = 0;
  
  if (arbitrageMultiplier > 0) {
    if (arbitrageMultiplier < 0.01) {
      // 资金费率 < 1%：线性增长，基础系数为 3
      ARBITRAGE_AMPLIFICATION = 3;
      ARBITRAGE_EAT_FACTOR = 4;
    } else {
      // 资金费率 >= 1%：指数级增长
      // 基础强度 + 指数增强
      // 当费率为1%时，强度为 3 + 0 = 3
      // 当费率为2%时，强度为 3 + 2 = 5
      // 当费率为3%时，强度为 3 + 6 = 9
      // 当费率为4%时，强度为 3 + 12 = 15
      // 当费率为5%时，强度为 3 + 20 = 23
      const excessRate = arbitrageMultiplier - 0.01; // 超过1%的部分
      const exponentialFactor = excessRate * 500; // 指数因子：每增加1%费率，强度增加5
      ARBITRAGE_AMPLIFICATION = 3 + exponentialFactor;
      ARBITRAGE_EAT_FACTOR = 4 + exponentialFactor * 1.5; // 吃单系数更强
    }
  }
  
  // 套利吃单记录（用于生成散户持仓）
  const arbitrageFills: { side: 'long' | 'short'; quantity: number; value: number; avgPrice: number }[] = [];
  
  // 当前基差（合约价格相对于现货价格的偏离）
  const currentBasis = markPrice && markPrice > 0 && basePrice > 0 
    ? (basePrice - markPrice) / markPrice 
    : 0;
  
  // ========== 合约市场套利吃单（增强版）============
  // 套利吃单会影响基准价格的计算，并生成散户持仓
  // 吃单后，基准价格会向套利方向移动
  
  // 计算套利吃单对价格的影响
  let arbitragePriceImpact = 0;
  
  // 用于套利吃单的临时订单簿副本
  let arbitrageBids: OrderBookEntry[] = [];
  let arbitrageAsks: OrderBookEntry[] = [];
  
  if (existingBook) {
    arbitrageBids = existingBook.bids.filter(b => !b.isPlayer).map(b => ({ ...b }));
    arbitrageAsks = existingBook.asks.filter(a => !a.isPlayer).map(a => ({ ...a }));
  }
  
  if (fundingRateMultiplier > 0) {
    // 正费率：合约价格 > 现货价格，套利者做空合约、买入现货
    // 合约端：主动卖出合约（吃掉买盘），压低合约价格
    
    let amplificationFactor = ARBITRAGE_AMPLIFICATION;
    let eatFactor = ARBITRAGE_EAT_FACTOR;
    
    // 检测合约价格是否正在向现货价格回归
    if (currentBasis < fundingRateMultiplier * 0.9) {
      // 基差正在缩小，减弱套利力度
      const reductionFactor = Math.max(0.3, 1 - (fundingRateMultiplier - currentBasis) * 10);
      amplificationFactor *= reductionFactor;
      eatFactor *= reductionFactor;
    }
    
    futuresAskMultiplier = 1 + arbitrageMultiplier * amplificationFactor;
    futuresBidMultiplier = Math.max(0.6, 1 - arbitrageMultiplier * amplificationFactor * 0.15);
    
    // 计算套利吃单量：主动卖出合约（吃掉买盘）
    const arbitrageEatQuantity = baseOrderQuantity * arbitrageMultiplier * eatFactor;
    
    // ========== 执行套利吃单并记录 ==========
    if (arbitrageEatQuantity > 0 && arbitrageBids.length > 0) {
      let remainingEat = arbitrageEatQuantity;
      let totalEatValue = 0;
      let totalEatQty = 0;
      
      for (let i = 0; i < arbitrageBids.length && remainingEat > 0; i++) {
        const bid = arbitrageBids[i];
        const eatQty = Math.min(remainingEat, bid.quantity);
        if (eatQty > 0) {
          remainingEat -= eatQty;
          totalEatValue += eatQty * bid.price;
          totalEatQty += eatQty;
          bid.quantity -= eatQty;
          bid.total = bid.price * bid.quantity;
        }
      }
      
      // 记录套利吃单信息（用于生成散户持仓）
      if (totalEatQty > 0) {
        const avgPrice = totalEatValue / totalEatQty;
        arbitrageFills.push({
          side: 'short', // 正费率时套利者做空合约，吃掉买盘（买盘被吃 = 有人卖出）
          quantity: totalEatQty,
          value: totalEatValue,
          avgPrice: avgPrice,
        });
      }
      
      // 计算吃单对价格的影响
      const totalBidDepth = arbitrageBids.reduce((sum, b) => sum + b.quantity, 0);
      if (totalBidDepth > 0) {
        const eatRatio = Math.min(1, arbitrageEatQuantity / (totalBidDepth + totalEatQty));
        arbitragePriceImpact = -basePrice * eatRatio * 0.03;
      }
    }
    
  } else if (fundingRateMultiplier < 0) {
    // 负费率：合约价格 < 现货价格，套利者做多合约、卖出现货
    // 合约端：主动买入合约（吃掉卖盘），推高合约价格
    
    let amplificationFactor = ARBITRAGE_AMPLIFICATION;
    let eatFactor = ARBITRAGE_EAT_FACTOR;
    
    // 检测合约价格是否正在向现货价格回归
    if (currentBasis > fundingRateMultiplier * 0.9) {
      // 基差正在缩小，减弱套利力度
      const reductionFactor = Math.max(0.3, 1 - (currentBasis - fundingRateMultiplier) * 10);
      amplificationFactor *= reductionFactor;
      eatFactor *= reductionFactor;
    }
    
    futuresBidMultiplier = 1 + arbitrageMultiplier * amplificationFactor;
    futuresAskMultiplier = Math.max(0.6, 1 - arbitrageMultiplier * amplificationFactor * 0.15);
    
    // 计算套利吃单量：主动买入合约（吃掉卖盘）
    const arbitrageEatQuantity = baseOrderQuantity * arbitrageMultiplier * eatFactor;
    
    // ========== 执行套利吃单并记录 ==========
    if (arbitrageEatQuantity > 0 && arbitrageAsks.length > 0) {
      let remainingEat = arbitrageEatQuantity;
      let totalEatValue = 0;
      let totalEatQty = 0;
      
      for (let i = 0; i < arbitrageAsks.length && remainingEat > 0; i++) {
        const ask = arbitrageAsks[i];
        const eatQty = Math.min(remainingEat, ask.quantity);
        if (eatQty > 0) {
          remainingEat -= eatQty;
          totalEatValue += eatQty * ask.price;
          totalEatQty += eatQty;
          ask.quantity -= eatQty;
          ask.total = ask.price * ask.quantity;
        }
      }
      
      // 记录套利吃单信息（用于生成散户持仓）
      if (totalEatQty > 0) {
        const avgPrice = totalEatValue / totalEatQty;
        arbitrageFills.push({
          side: 'long', // 负费率时套利者做多合约，吃掉卖盘（卖盘被吃 = 有人买入）
          quantity: totalEatQty,
          value: totalEatValue,
          avgPrice: avgPrice,
        });
      }
      
      // 计算吃单对价格的影响
      const totalAskDepth = arbitrageAsks.reduce((sum, a) => sum + a.quantity, 0);
      if (totalAskDepth > 0) {
        const eatRatio = Math.min(1, arbitrageEatQuantity / (totalAskDepth + totalEatQty));
        arbitragePriceImpact = basePrice * eatRatio * 0.03;
      }
    }
  }
  
  // 清理套利吃单后数量为0的订单
  arbitrageBids = arbitrageBids.filter(b => b.quantity > 0.001);
  arbitrageAsks = arbitrageAsks.filter(a => a.quantity > 0.001);

  // ========== 价格回归调整（极温和版）============
  // 关键修复：当合约价格与标记价格存在偏差时，调整订单生成价格使其回归
  // 但回归力度要极温和，确保初始阶段价差控制在±1%-2%以内
  // 同时确保玩家限价单能够正常成交
  let priceAdjustFactor = 0;
  if (markPrice && markPrice > 0 && basePrice > 0) {
    // 计算合约价格与标记价格的偏差比例
    const priceDeviation = (basePrice - markPrice) / markPrice;
    
    // 极温和型价格回归因子：限制最大回归力度为10%
    // 确保初始阶段价差不会过大
    // 偏差 < 5%：回归5%
    // 偏差 5-10%：回归8%
    // 偏差 10-20%：回归10%（最大）
    // 偏差 > 20%：仍为10%，避免过度调整
    let regressionFactor = 0.05;
    const absDeviation = Math.abs(priceDeviation);
    if (absDeviation > 0.2) {
      regressionFactor = 0.1;
    } else if (absDeviation > 0.1) {
      regressionFactor = 0.1;
    } else if (absDeviation > 0.05) {
      regressionFactor = 0.08;
    }
    
    priceAdjustFactor = -priceDeviation * regressionFactor;
  }
  
  // 调整后的基准价格（向标记价格温和回归，并考虑套利吃单影响）
  // 关键修复：限制调整后的价格与标记价格的偏差不超过2%
  let adjustedBasePrice = markPrice && markPrice > 0 
    ? basePrice * (1 + priceAdjustFactor) + arbitragePriceImpact
    : basePrice + arbitragePriceImpact;
  
  // 确保调整后的价格与标记价格的偏差控制在±2%以内
  if (markPrice && markPrice > 0) {
    const maxDeviation = 0.02; // 最大偏差2%
    const currentDeviation = (adjustedBasePrice - markPrice) / markPrice;
    if (Math.abs(currentDeviation) > maxDeviation) {
      // 限制偏差在±2%以内
      adjustedBasePrice = markPrice * (1 + Math.sign(currentDeviation) * maxDeviation);
    }
  }
  
  // 确保价格为正数
  adjustedBasePrice = Math.max(0.0000001, adjustedBasePrice);

  // ========== 合约—现货盘口联动 ==========
  // 合约盘口锚定现货订单簿最优买卖价中值（而非仅依赖 lastPrice），避免两个市场长期脱钩。
  // 保留资金费率基差：正费率→合约溢价、负费率→合约折价，套利方向与费率相反（与 arbitrageFills 一致）。
  if (spotBook && spotBook.bids.length > 0 && spotBook.asks.length > 0) {
    const spotBestBid = spotBook.bids[0]?.price || 0;
    const spotBestAsk = spotBook.asks[0]?.price || 0;
    if (spotBestBid > 0 && spotBestAsk > 0) {
      const spotMid = (spotBestBid + spotBestAsk) / 2;
      const basisTarget = Math.max(-0.02, Math.min(0.02, fundingRateMultiplier * 0.5));
      const targetMid = spotMid * (1 + basisTarget);
      // 保留部分原模型结果，再向现货盘口中值收敛
      adjustedBasePrice = adjustedBasePrice * 0.35 + targetMid * 0.65;
      // 再次限制与标记价偏差 ±2.5%，防止现货与标记价极端背离
      if (markPrice && markPrice > 0) {
        const spotAnchorDeviation = (adjustedBasePrice - markPrice) / markPrice;
        if (Math.abs(spotAnchorDeviation) > 0.025) {
          adjustedBasePrice = markPrice * (1 + Math.sign(spotAnchorDeviation) * 0.025);
        }
      }
      adjustedBasePrice = Math.max(0.0000001, adjustedBasePrice);
    }
  }

  // ========== 营销效果调整 ==========
  // FOMO：买单生成提升50%
  // 恐慌：卖单生成提升50%
  if (marketingEffect === 'fomo') {
    // 制造FOMO：买盘增加50%
    futuresBidMultiplier *= 1.5;
  } else if (marketingEffect === 'panic') {
    // 制造恐慌：卖盘增加50%
    futuresAskMultiplier *= 1.5;
  }

  // ========== 涨跌幅影响盘口机制 ==========
  // 【连续涨跌追踪】使用累计涨跌幅而非单回合涨跌幅
  // 连续上涨时：使用从连续上涨起始第一回合到当前回合的总涨幅
  // 连续下跌时：使用从连续下跌起始第一回合到当前回合的总跌幅
  // 当涨幅为x%，下回合卖单增加x%（即卖单乘以 1+x%）
  // 当跌幅为y%，下回合买单增加 1/(1-y%)（即买单乘以 1/(1-y%)）
  // 【关键修复】同时调整价格间距，避免买卖盘价格交叉
  let futuresPriceSpreadAdjust = 0; // 价格间距调整系数
  
  if (cumulativeChange > 0) {
    // 累计上涨，下回合卖单增加（获利盘抛压）
    futuresAskMultiplier *= (1 + cumulativeChange);
    // 【关键修复】涨幅越大，卖盘价格间距越大（卖方预期更高价格）
    // 同时买盘价格间距也扩大（买方更谨慎）
    // 价格间距调整系数：涨幅10%时，间距扩大约0.5%；涨幅30%时，间距扩大约1.5%
    futuresPriceSpreadAdjust = cumulativeChange * 0.05;
  } else if (cumulativeChange < 0) {
    // 累计下跌，下回合买单增加（抄底盘支撑）
    // cumulativeChange是负数，如-0.05表示下跌5%
    // 跌幅y%时买单增加1/(1-y%)
    // 如果跌幅是5%，则y=5，1/(1-0.05) = 1/0.95 ≈ 1.053
    // cumulativeChange = -y/100，所以 1/(1-y%) = 1/(1+cumulativeChange)
    futuresBidMultiplier *= (1 / (1 + cumulativeChange));
    // 【关键修复】跌幅越大，买盘价格间距越大（买方预期更低价格）
    // 同时卖盘价格间距也扩大（卖方更恐慌）
    // 价格间距调整系数：跌幅10%时，间距扩大约0.5%；跌幅30%时，间距扩大约1.5%
    futuresPriceSpreadAdjust = Math.abs(cumulativeChange) * 0.05;
  }
  
  // 【关键修复】根据涨跌幅调整合约盘口的价格间距
  // 确保买一价始终低于卖一价
  const futuresBidSpread = 0.002 * (1 + futuresPriceSpreadAdjust); // 买盘价格间距
  const futuresAskSpread = 0.002 * (1 + futuresPriceSpreadAdjust); // 卖盘价格间距

  // 生成买盘（买一到买十，价格从高到低）
  // 使用调整后的基准价格生成订单，使价格向标记价格回归
  // 【关键修复】使用动态价格间距，避免买卖盘价格交叉
  const bids: OrderBookEntry[] = [];
  let bidPrice = adjustedBasePrice * (1 - futuresBidSpread); // 买一价略低于基准价格，使用动态间距
  for (let i = 0; i < baseDepth; i++) {
    // 买盘数量：价格越低，数量越多（支撑效应），按 10 档权重从单边总深度摊分
    const levelBase = bidLevelBases[i] ?? 0;
    // 应用随机、多空系数与订单缩放（观察/即将下架/收缩各 ×0.5）
    const quantity = levelBase * (0.8 + Math.random() * 0.4) * futuresBidMultiplier * orderScale;
    const levelQuantity = Math.max(quantity, minLevelQuantity);
    
    // 价格下限为0
    const safeBidPrice = Math.max(0.0000001, bidPrice);
    
    bids.push({
      price: safeBidPrice,
      quantity: levelQuantity,
      total: safeBidPrice * levelQuantity,
      isPlayer: false,
    });
    
    bidPrice *= (1 - depthPercent * (0.5 + Math.random() * 0.5));
    // 确保价格不会变成负数
    if (bidPrice < 0.0000001) bidPrice = 0.0000001;
  }
  
  // 生成卖盘（卖一到卖十，价格从低到高）
  // 使用调整后的基准价格生成订单，使价格向标记价格回归
  // 【关键修复】使用动态价格间距，避免买卖盘价格交叉
  const asks: OrderBookEntry[] = [];
  let askPrice = adjustedBasePrice * (1 + futuresAskSpread); // 卖一价略高于基准价格，使用动态间距
  for (let i = 0; i < baseDepth; i++) {
    // 卖盘数量：价格越高，数量越多（抛压效应），按 10 档权重从单边总深度摊分
    const levelBase = askLevelBases[i] ?? 0;
    // 应用随机、多空系数与订单缩放（观察/即将下架/收缩各 ×0.5）
    const quantity = levelBase * (0.8 + Math.random() * 0.4) * futuresAskMultiplier * orderScale;
    const levelQuantity = Math.max(quantity, minLevelQuantity);
    
    asks.push({
      price: askPrice,
      quantity: levelQuantity,
      total: askPrice * levelQuantity,
      isPlayer: false,
    });
    
    askPrice *= (1 + depthPercent * (0.5 + Math.random() * 0.5));
  }
  
  // 如果存在旧订单簿，保留玩家挂单
  // 记录玩家挂单的成交信息，用于返回给调用方更新订单状态
  const playerOrderFills: Record<string, { filledQuantity: number; filledTokenQty: number; avgPrice: number }> = {};

  if (existingBook) {
    // 保留玩家买盘挂单
    const playerBids = existingBook.bids.filter(b => b.isPlayer);
    for (const playerBid of playerBids) {
      // 检查价格是否在合理范围内
      if (playerBid.price > 0 && playerBid.quantity > 0) {
        // 关键修复：在插入玩家买单前，检查新卖盘是否可以成交
        // 玩家开多限价单：当卖一价 <= 买单价时成交
        let remainingQty = playerBid.quantity;
        let totalFilledValue = 0;
        let totalFilledQty = 0;

        for (let i = 0; i < asks.length && remainingQty > 0; i++) {
          const ask = asks[i];
          // 跳过其他玩家挂单
          if (ask.isPlayer) continue;
          // 卖价 <= 买单价时成交
          if (ask.price <= playerBid.price) {
            const fillQty = Math.min(remainingQty, ask.quantity);
            if (fillQty > 0) {
              totalFilledValue += fillQty * ask.price;
              totalFilledQty += fillQty;
              remainingQty -= fillQty;
              ask.quantity -= fillQty;
              ask.total = ask.price * ask.quantity;
            }
          } else {
            break; // 卖盘按价格升序排列，后续价格更高
          }
        }

        // 记录成交信息（如果有成交且存在订单ID）
        if (totalFilledQty > 0 && playerBid.orderId) {
          playerOrderFills[playerBid.orderId] = {
            filledQuantity: totalFilledValue, // 成交金额
            filledTokenQty: totalFilledQty, // 成交代币数量
            avgPrice: totalFilledValue / totalFilledQty,
          };
        }

        // 只有未完全成交的挂单才插入
        // 关键修复：创建新的订单对象，确保isPlayer和orderId字段被正确保留
        if (remainingQty > 0.001) {
          const newPlayerBid: OrderBookEntry = {
            price: playerBid.price,
            quantity: remainingQty,
            total: playerBid.price * remainingQty,
            isPlayer: true,
            orderId: playerBid.orderId, // 保留订单ID
          };
          const insertIndex = bids.findIndex(b => b.price < playerBid.price);
          if (insertIndex >= 0) {
            bids.splice(insertIndex, 0, newPlayerBid);
          } else {
            bids.push(newPlayerBid);
          }
        }
      }
    }

    // 保留玩家卖盘挂单
    const playerAsks = existingBook.asks.filter(a => a.isPlayer);
    for (const playerAsk of playerAsks) {
      // 检查价格是否在合理范围内
      if (playerAsk.price > 0 && playerAsk.quantity > 0) {
        // 关键修复：在插入玩家卖单前，检查新买盘是否可以成交
        // 玩家开空限价单：当买一价 >= 卖单价时成交
        let remainingQty = playerAsk.quantity;
        let totalFilledValue = 0;
        let totalFilledQty = 0;

        for (let i = 0; i < bids.length && remainingQty > 0; i++) {
          const bid = bids[i];
          // 跳过其他玩家挂单
          if (bid.isPlayer) continue;
          // 买价 >= 卖单价时成交
          if (bid.price >= playerAsk.price) {
            const fillQty = Math.min(remainingQty, bid.quantity);
            if (fillQty > 0) {
              totalFilledValue += fillQty * bid.price;
              totalFilledQty += fillQty;
              remainingQty -= fillQty;
              bid.quantity -= fillQty;
              bid.total = bid.price * bid.quantity;
            }
          } else {
            break; // 买盘按价格降序排列，后续价格更低
          }
        }

        // 记录成交信息（如果有成交且存在订单ID）
        if (totalFilledQty > 0 && playerAsk.orderId) {
          playerOrderFills[playerAsk.orderId] = {
            filledQuantity: totalFilledValue, // 成交金额
            filledTokenQty: totalFilledQty, // 成交代币数量
            avgPrice: totalFilledValue / totalFilledQty,
          };
        }

        // 只有未完全成交的挂单才插入
        // 关键修复：创建新的订单对象，确保isPlayer和orderId字段被正确保留
        if (remainingQty > 0.001) {
          const newPlayerAsk: OrderBookEntry = {
            price: playerAsk.price,
            quantity: remainingQty,
            total: playerAsk.price * remainingQty,
            isPlayer: true,
            orderId: playerAsk.orderId, // 保留订单ID
          };
          const insertIndex = asks.findIndex(a => a.price > playerAsk.price);
          if (insertIndex >= 0) {
            asks.splice(insertIndex, 0, newPlayerAsk);
          } else {
            asks.push(newPlayerAsk);
          }
        }
      }
    }
  }

  // 清理数量为0的订单
  let filteredBids = bids.filter(b => b.quantity > 0.001);
  let filteredAsks = asks.filter(a => a.quantity > 0.001);

  // 按价格排序
  filteredBids.sort((a, b) => b.price - a.price); // 买盘降序
  filteredAsks.sort((a, b) => a.price - b.price); // 卖盘升序

  // ========== 关键修复：检查并处理交叉盘（买一价 >= 卖一价）==========
  // 当买一价高于或等于卖一价时，需要进行撮合成交
  // 这是合约市场正常的价格发现机制
  let crossMatchRounds = 0;
  const MAX_CROSS_MATCH_ROUNDS = 10; // 防止无限循环

  while (filteredBids.length > 0 && filteredAsks.length > 0 && crossMatchRounds < MAX_CROSS_MATCH_ROUNDS) {
    const bestBid = filteredBids[0];
    const bestAsk = filteredAsks[0];

    // 检查是否存在交叉：买一价 >= 卖一价
    if (bestBid.price >= bestAsk.price) {
      // 存在交叉，进行撮合
      const matchQuantity = Math.min(bestBid.quantity, bestAsk.quantity);
      const matchPrice = bestAsk.price; // 以卖一价成交（买方主动吃单）

      if (matchQuantity > 0.001) {
        // 更新买卖盘数量
        bestBid.quantity -= matchQuantity;
        bestAsk.quantity -= matchQuantity;
        bestBid.total = bestBid.price * bestBid.quantity;
        bestAsk.total = bestAsk.price * bestAsk.quantity;

        // 如果是玩家订单被成交，记录成交信息
        if (bestBid.isPlayer && bestBid.orderId) {
          if (!playerOrderFills[bestBid.orderId]) {
            playerOrderFills[bestBid.orderId] = { filledQuantity: 0, filledTokenQty: 0, avgPrice: 0 };
          }
          const prevFill = playerOrderFills[bestBid.orderId];
          const newFilledQty = prevFill.filledTokenQty + matchQuantity;
          const newFilledValue = prevFill.filledQuantity + matchQuantity * matchPrice;
          playerOrderFills[bestBid.orderId] = {
            filledQuantity: newFilledValue,
            filledTokenQty: newFilledQty,
            avgPrice: newFilledQty > 0 ? newFilledValue / newFilledQty : 0,
          };
        }

        if (bestAsk.isPlayer && bestAsk.orderId) {
          if (!playerOrderFills[bestAsk.orderId]) {
            playerOrderFills[bestAsk.orderId] = { filledQuantity: 0, filledTokenQty: 0, avgPrice: 0 };
          }
          const prevFill = playerOrderFills[bestAsk.orderId];
          const newFilledQty = prevFill.filledTokenQty + matchQuantity;
          const newFilledValue = prevFill.filledQuantity + matchQuantity * matchPrice;
          playerOrderFills[bestAsk.orderId] = {
            filledQuantity: newFilledValue,
            filledTokenQty: newFilledQty,
            avgPrice: newFilledQty > 0 ? newFilledValue / newFilledQty : 0,
          };
        }
      }

      // 清理数量为0的订单
      if (bestBid.quantity <= 0.001) {
        filteredBids.shift();
      }
      if (bestAsk.quantity <= 0.001) {
        filteredAsks.shift();
      }

      crossMatchRounds++;
    } else {
      // 不存在交叉，退出循环
      break;
    }
  }

  // 再次清理和排序（确保盘口正确）
  filteredBids = filteredBids.filter(b => b.quantity > 0.001);
  filteredAsks = filteredAsks.filter(a => a.quantity > 0.001);
  filteredBids.sort((a, b) => b.price - a.price); // 买盘降序
  filteredAsks.sort((a, b) => a.price - b.price); // 卖盘升序

  // 计算资金费率（已包含±5%上限）
  // 资金费率 = (合约价格 - 现货价格) / 现货价格
  // 关键修复：使用合约中间价计算资金费率，而非买一价
  // 这样可以更准确地反映合约的真实价格，避免套利机制的循环反馈
  const contractBidOne = filteredBids.length > 0 ? filteredBids[0].price : basePrice;
  const contractAskOne = filteredAsks.length > 0 ? filteredAsks[0].price : basePrice * 1.01;
  const contractMidPrice = (contractBidOne + contractAskOne) / 2; // 使用中间价
  const spotPrice = token.currentPrice;
  const fundingRate = calculateFundingRate(contractMidPrice, spotPrice, getFundingConfig(getTokenTier(token)).maxRate);

  // 标记价格等于现货买一价与合约买一价的几何平均数
  // 如果传入了markPrice参数，则使用传入的值（几何平均数）
  // 否则使用token.currentPrice作为后备
  const finalMarkPrice = markPrice && markPrice > 0 ? markPrice : Math.max(0.0000001, spotPrice);

  // 计算总量
  const totalBidQuantity = filteredBids.reduce((sum, b) => sum + b.quantity, 0);
  const totalAskQuantity = filteredAsks.reduce((sum, a) => sum + a.quantity, 0);

  // lastPrice使用合约买一价，markPrice使用现货买一价与合约买一价的几何平均数
  const lastPrice = contractBidOne;

  return {
    bids: filteredBids,
    asks: filteredAsks,
    lastPrice,
    markPrice: finalMarkPrice,
    indexPrice: spotPrice,
    fundingRate,
    nextFundingTime: 0, // 将在运行时设置
    totalBidQuantity,
    totalAskQuantity,
    // 返回玩家挂单成交信息，用于更新订单状态
    playerOrderFills,
    // 返回套利吃单信息，用于生成散户持仓
    arbitrageFills,
  };
}

/**
 * 检查散户持仓是否需要强平
 */
export function checkRetailLiquidation(
  retailPositions: RetailPosition[],
  markPrice: number
): { liquidatedPositions: RetailPosition[]; remainingPositions: RetailPosition[] } {
  const liquidatedPositions: RetailPosition[] = [];
  const remainingPositions: RetailPosition[] = [];
  
  for (const pos of retailPositions) {
    let shouldLiquidate = false;
    
    if (pos.side === 'long' && markPrice <= pos.liquidationPrice) {
      shouldLiquidate = true;
    } else if (pos.side === 'short' && markPrice >= pos.liquidationPrice) {
      shouldLiquidate = true;
    }
    
    if (shouldLiquidate) {
      liquidatedPositions.push(pos);
    } else {
      remainingPositions.push(pos);
    }
  }
  
  return { liquidatedPositions, remainingPositions };
}

/**
 * 计算玩家合约持仓盈亏
 */
export function calculateFuturesPnl(
  position: FuturesPosition,
  markPrice: number
): { unrealizedPnl: number; roe: number } {
  // 使用持仓金额计算盈亏
  const openValue = position.value || (position.quantity * position.entryPrice); // 兼容旧数据
  const currentValue = position.quantity * markPrice;
  let unrealizedPnl: number;
  
  if (position.side === 'long') {
    // 做多盈亏 = 当前市值 - 开仓金额
    unrealizedPnl = currentValue - openValue;
  } else {
    // 做空盈亏 = 开仓金额 - 当前市值
    unrealizedPnl = openValue - currentValue;
  }
  
  // 收益率 = 未实现盈亏 / 保证金
  const roe = position.margin > 0 ? (unrealizedPnl / position.margin) * 100 : 0;
  
  return { unrealizedPnl, roe };
}

/**
 * 处理AI持仓强平（公共函数，用于AI交易员和做市商）
 * @param positions 持仓数组
 * @param futuresBookUpdates 合约订单簿更新映射
 * @param availableCapital 可用资金
 * @param onLiquidation 强平时的回调（可选，用于生成情绪帖子）
 * @returns 更新后的持仓数组和可用资金
 */
export function processAILiquidation(
  positions: AIFuturesPosition[],
  futuresBookUpdates: Record<string, FuturesOrderBook>,
  availableCapital: number,
  onLiquidation?: (tokenId: string, pnlPercent: number, side: 'long' | 'short') => void
): { updatedPositions: AIFuturesPosition[]; updatedCapital: number; liquidationAmounts: Record<string, { shortAmount: number; longAmount: number }> } {
  // 强平金额追踪：按代币ID区分多头和空头
  const liquidationAmounts: Record<string, { shortAmount: number; longAmount: number }> = {};
  
  if (!positions || positions.length === 0) {
    return { updatedPositions: positions, updatedCapital: availableCapital, liquidationAmounts };
  }

  let updatedCapital = availableCapital;

  // 【AI全仓模式】保证金池计算放在每个仓位的检查中：
  // 保证金池 = 可用资金 + 所有持仓保证金 + 除本仓外其他仓位的浮动盈亏
  // AI资金语义：开仓时已从availableCapital扣除margin（无冻结概念），故保证金池需加回所有持仓保证金
  // 注意：其他仓位的亏损会消耗保证金池（负盈亏也要计入），否则保证金池被高估，强平无法及时触发
  const liquidatedPositions: AIFuturesPosition[] = [];
  const remainingPositions: AIFuturesPosition[] = [];
  let crossLiquidationTriggered = false;

  positions.forEach(position => {
    const futuresBook = futuresBookUpdates[position.tokenId];
    if (!futuresBook) {
      remainingPositions.push(position);
      return;
    }

    const markPrice = futuresBook.markPrice;
    const marginMode = position.marginMode || 'cross'; // 旧持仓默认全仓
    let shouldLiquidate = false;

    if (marginMode === 'cross') {
      // 全仓模式：动态计算强平价格（基于总保证金池），任一仓位触发则全部强平
      // 对每个仓位单独计算保证金池：可用资金 + 所有持仓保证金 + 除本仓外其他仓位的浮动盈亏
      // （本仓自身的浮动盈亏随价格变动，不预支进池，避免强平价失真）
      const positionValue = position.quantity * position.entryPrice;
      let poolForPosition = availableCapital;
      positions.forEach(other => {
        poolForPosition += other.margin;
        if (other === position) return;
        const otherBook = futuresBookUpdates[other.tokenId];
        if (!otherBook) return;
        const otherPnl = other.side === 'long'
          ? (otherBook.markPrice - other.entryPrice) * other.quantity
          : (other.entryPrice - otherBook.markPrice) * other.quantity;
        poolForPosition += otherPnl;
      });
      poolForPosition = Math.max(0, poolForPosition);
      const crossLiqPrice = calculateCrossLiquidationPrice(position.side, position.entryPrice, poolForPosition, positionValue);
      if (position.side === 'long' && markPrice <= crossLiqPrice) {
        shouldLiquidate = true;
      } else if (position.side === 'short' && markPrice >= crossLiqPrice) {
        shouldLiquidate = true;
      }
      if (shouldLiquidate) crossLiquidationTriggered = true;
    } else {
      // 逐仓模式：按仓位自身强平价格
      shouldLiquidate = (position.side === 'long' && markPrice <= position.liquidationPrice) ||
                        (position.side === 'short' && markPrice >= position.liquidationPrice);
    }

    if (shouldLiquidate) {
      liquidatedPositions.push(position);
    } else {
      remainingPositions.push(position);
    }
  });

  // 全仓模式触发强平：所有仓位一起强平（含未单独触发、盘口缺失或属性重复的仓位），现金资产全部归零
  if (crossLiquidationTriggered) {
    liquidatedPositions.length = 0;
    positions.forEach(position => liquidatedPositions.push(position));
    remainingPositions.length = 0;
    updatedCapital = 0;
  }

  // 处理强平（吃单平仓 + 回调 + 金额追踪）
  liquidatedPositions.forEach(position => {
    const futuresBook = futuresBookUpdates[position.tokenId];
    if (!futuresBook) return;

    const markPrice = futuresBook.markPrice;
    const pnl = position.side === 'long'
      ? (markPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - markPrice) * position.quantity;

    const pnlPercent = (pnl / position.margin) * 100;
    
    // 触发强平回调
    if (onLiquidation) {
      onLiquidation(position.tokenId, pnlPercent, position.side);
    }
    
    // 【强平金额追踪】记录AI交易员/做市商的强平金额
    const positionValue = position.quantity * position.entryPrice;
    if (!liquidationAmounts[position.tokenId]) {
      liquidationAmounts[position.tokenId] = { shortAmount: 0, longAmount: 0 };
    }
    if (position.side === 'short') {
      liquidationAmounts[position.tokenId].shortAmount += positionValue;
    } else {
      liquidationAmounts[position.tokenId].longAmount += positionValue;
    }

    // 更新订单簿
    let remainingQty = position.quantity;
    if (position.side === 'long') {
      const newBids = [...futuresBook.bids];
      for (let i = 0; i < newBids.length && remainingQty > 0.001; i++) {
        const bid = newBids[i];
        if (bid.isPlayer) continue;
        const fillQty = Math.min(bid.quantity, remainingQty);
        bid.quantity -= fillQty;
        bid.total = bid.price * bid.quantity;
        remainingQty -= fillQty;
      }
      futuresBook.bids = newBids.filter(b => b.quantity > 0.001);
      futuresBook.totalBidQuantity = futuresBook.bids.reduce((sum, b) => sum + b.quantity, 0);
    } else {
      const newAsks = [...futuresBook.asks];
      for (let i = 0; i < newAsks.length && remainingQty > 0.001; i++) {
        const ask = newAsks[i];
        if (ask.isPlayer) continue;
        const fillQty = Math.min(ask.quantity, remainingQty);
        ask.quantity -= fillQty;
        ask.total = ask.price * ask.quantity;
        remainingQty -= fillQty;
      }
      futuresBook.asks = newAsks.filter(a => a.quantity > 0.001);
      futuresBook.totalAskQuantity = futuresBook.asks.reduce((sum, a) => sum + a.quantity, 0);
    }

    // 逐仓模式：按实际盈亏结算到资金
    // 开仓时保证金已从可用资金扣除，平仓后剩余权益（保证金 + 已实现盈亏）结算回资金；
    // 若亏损超过保证金，超出部分同样从资金中扣除（全仓模式资金已归零，不重复结算）
    if (!crossLiquidationTriggered) {
      updatedCapital += position.margin + pnl;
    }
  });

  return { updatedPositions: remainingPositions, updatedCapital: Math.max(0, updatedCapital), liquidationAmounts };
}
