// 从 src/App.tsx 机械搬迁（Stage 1），逻辑未改动。
import type { Candle, Level2OrderBook, LiquidityPool, Order, OrderBookEntry, Token } from '../types';
import { generateAMMQuoteLevels } from './amm';
import { getMechanicsTier, getTierHighLowFloatRange, getTierVolatilityRange } from '../data/tokenMeta';
import { computeSideDepth, computeWeightedLevelBases } from './depth';

/**
 * 合并LOB限价单与AMM报价
 * 优先使用真实挂单，流动性不足时由AMM补充
 */
export function mergePriceLevels(
  primary: OrderBookEntry[],    // 优先使用真实挂单
  secondary: OrderBookEntry[],  // AMM报价作为补充
  toleranceBp: number = 1       // 价格容差（基点）
): OrderBookEntry[] {
  const merged: OrderBookEntry[] = [];
  const usedPrices = new Set<number>();
  
  // 价格容差
  const tolerance = toleranceBp / 10000;
  
  // 先添加真实挂单
  for (const order of primary) {
    merged.push({ ...order });
    // 记录已使用的价格区间
    usedPrices.add(order.price);
  }
  
  // 补充AMM报价（避免与真实挂单价格重叠）
  for (const ammOrder of secondary) {
    // 检查是否与已有订单价格重叠
    let hasOverlap = false;
    for (const existingPrice of usedPrices) {
      if (Math.abs(ammOrder.price - existingPrice) / existingPrice < tolerance) {
        hasOverlap = true;
        break;
      }
    }
    
    if (!hasOverlap) {
      merged.push({ ...ammOrder });
      usedPrices.add(ammOrder.price);
    }
  }
  
  return merged;
}

/**
 * 生成融合LOB与AMM的Level-2盘口
 * CEX模式：纯限价单盘口
 * DEX模式：融合LP与限价单的盘口，优先使用真实挂单，流动性不足时由AMM补充
 */
export function generateHybridOrderBook(
  token: Token,
  prevCandle: Candle,
  volatility: number,
  playerHoldings: number,
  lobOrders: { bids: OrderBookEntry[]; asks: OrderBookEntry[] },
  pool: LiquidityPool | null,
  marketMode: 'cex' | 'dex' = 'cex'
): Level2OrderBook {
  // 根据tier确定高低价浮动范围（与K线高低价浮动范围一致）
  const tier = getMechanicsTier(token);
  const { floatMin: highLowFloatMin, floatMax: highLowFloatMax } = getTierHighLowFloatRange(tier);

  // CEX模式：直接使用限价单盘口
  if (marketMode === 'cex' || !pool) {
    const bids = lobOrders.bids.sort((a, b) => b.price - a.price);
    const asks = lobOrders.asks.sort((a, b) => a.price - b.price);
    const lastPrice = bids.length > 0 ? bids[0].price : (asks.length > 0 ? asks[0].price : token.currentPrice);
    
    // 高低价独立随机生成，不与盘口价格关联
    let highPrice: number, lowPrice: number;
    if (prevCandle) {
      highPrice = prevCandle.high;
      lowPrice = prevCandle.low;
    } else {
      // 无历史K线时，基于当前价格独立随机生成高低价
      const highFloat = highLowFloatMin + Math.random() * (highLowFloatMax - highLowFloatMin);
      const lowFloat = highLowFloatMin + Math.random() * (highLowFloatMax - highLowFloatMin);
      highPrice = token.currentPrice * (1 + highFloat);
      lowPrice = token.currentPrice * (1 - lowFloat);
    }
    
    return {
      tokenId: token.id,
      bids,
      asks,
      lastPrice,
      highPrice,
      lowPrice,
      totalBidQuantity: bids.reduce((sum, b) => sum + b.quantity, 0),
      totalAskQuantity: asks.reduce((sum, a) => sum + a.quantity, 0),
      marketMode: 'cex',
    };
  }
  
  // DEX模式：只使用AMM流动性池报价，不显示CEX限价单
  // 【修复】使用实际价格而不是lastPrice，避免因syncLiquidityPoolWithHoldings调整导致的价格不一致
  const centerPrice = pool.quoteReserve / pool.tokenReserve;
  
  // 从AMM生成虚拟盘口（纯AMM模式）
  const ammQuotes = generateAMMQuoteLevels(pool, centerPrice, 20, 10);
  
  // DEX模式只使用AMM报价，不合并CEX限价单
  const bids = ammQuotes.bids.sort((a, b) => b.price - a.price);
  const asks = ammQuotes.asks.sort((a, b) => a.price - b.price);
  
  // 计算中间价
  const bestBid = bids.length > 0 ? bids[0].price : centerPrice * 0.99;
  const bestAsk = asks.length > 0 ? asks[0].price : centerPrice * 1.01;
  const lastPrice = (bestBid + bestAsk) / 2;
  
  // 高低价独立随机生成，不与盘口价格或DEX价格关联
  let highPrice: number, lowPrice: number;
  if (prevCandle) {
    highPrice = prevCandle.high;
    lowPrice = prevCandle.low;
  } else {
    // 无历史K线时，基于当前价格独立随机生成高低价
    const highFloat = highLowFloatMin + Math.random() * (highLowFloatMax - highLowFloatMin);
    const lowFloat = highLowFloatMin + Math.random() * (highLowFloatMax - highLowFloatMin);
    highPrice = centerPrice * (1 + highFloat);
    lowPrice = centerPrice * (1 - lowFloat);
  }
  
  return {
    tokenId: token.id,
    bids,
    asks,
    lastPrice,
    highPrice,
    lowPrice,
    totalBidQuantity: bids.reduce((sum, b) => sum + b.quantity, 0),
    totalAskQuantity: asks.reduce((sum, a) => sum + a.quantity, 0),
    marketMode: 'dex',
    ammPool: pool,
  };
}

/**
 * 核心盘口生成逻辑 - 重构版
 * 
 * 规则：
 * 1. 价格由盘口决定：买一价和卖一价的中间价作为当前价
 * 2. 流通量影响：玩家持仓占比越高，流通量越少，价格波动越大
 * 3. 卖压机制：价格上涨时，早期持仓者和获利盘会释放卖压
 * 4. 买盘支撑：价格下跌时，买盘数量增加
 * 5. 深度根据市值动态调整
 * 
 * 【有效市值机制】
 * 盘口生成的订单数量根据有效市值计算，而非总市值
 * 有效市值 = 总市值 * (1 - 玩家持仓占比 - AI交易员持仓占比 - 做市商持仓占比)
 */
export function generateLevel2OrderBook(
  token: Token,
  prevCandle: Candle,
  volatility: number,
  playerHoldings: number,
  aiHoldingRatio: number = 0, // AI角色持仓占比（默认0，用于初始化）
  marketMakerHoldingRatio: number = 0, // 做市商持仓占比（默认0，用于初始化）
  orderScale: number = 1, // 盘口订单量缩放系数（观察标签代币为0.5，订单生成减少50%）
  heat: number = 0, // 热度（0-100），与回合滚动生成盘口共用同一深度口径
  bidScale: number = 1, // 买盘独立缩放（即将下架期间 0.5）
  askScale: number = 1 // 卖盘独立缩放（即将下架期间 2）
): Level2OrderBook {
  const basePrice = prevCandle ? prevCandle.close : token.currentPrice;
  const bids: OrderBookEntry[] = [];
  const asks: OrderBookEntry[] = [];

  // 计算流通量 - 安全检查防止除零
  const safeCirculatingSupply = token.circulatingSupply > 0.0001 ? token.circulatingSupply : 0.0001;
  const holdingRatio = playerHoldings / safeCirculatingSupply;

  // 根据市值确定订单深度百分比（与回合滚动生成一致）
  let depthPercent = 0.03; // 基础3%价差
  if (token.marketCap > 500000000) depthPercent = 0.01;
  else if (token.marketCap > 100000000) depthPercent = 0.02;
  else if (token.marketCap < 1000000) depthPercent = 0.05;

  // 流通量减少时，深度变浅，波动增大
  const liquidityFactor = Math.max(0.2, 1 - holdingRatio * 0.8);
  const effectiveDepth = depthPercent / liquidityFactor;

  // ========== 盘口深度模型：USDT 单边总深度（与回合滚动生成同口径） ==========
  // 单边总深度（USDT）= 流通市值 × 0.02% + 5000U 底仓 + (热度/100) × 30万U
  const sideDepthPrice = basePrice > 0 ? basePrice : token.currentPrice;
  const sideDepth = computeSideDepth({
    circulatingSupply: safeCirculatingSupply,
    totalSupply: token.totalSupply,
    price: sideDepthPrice,
    heat,
  });
  const { bidLevelBases, askLevelBases } = computeWeightedLevelBases(sideDepth.totalDepthTokens, 10, 0.12, 0.15);
  const maxSingleLevelQuantity = sideDepth.totalDepthTokens * 0.2;
  const maxSideQuantity = sideDepth.totalDepthTokens * 1.5;
  const askLevelFloorQuantity = Math.max((bidLevelBases[0] || 0) * 1e-5, 0.002);

  // 卖盘减少机制：持仓占比越高，卖盘越少（与回合滚动生成一致）
  const sellDecayFactor = Math.pow(1 - Math.min(0.95, holdingRatio), 0.5);

  // ========== 生成买盘（买一到买十） ==========
  let bidPrice = basePrice * (1 - 0.002); // 买一价略低于当前价
  let totalBidGenerated = 0;
  for (let i = 0; i < 10; i++) {
    // 按 10 档权重从单边总深度摊分，并叠加持仓流动性系数
    let quantity = (bidLevelBases[i] ?? 0) * liquidityFactor * (0.85 + Math.random() * 0.3);
    quantity = Math.min(quantity, maxSingleLevelQuantity);
    if (totalBidGenerated + quantity > maxSideQuantity) {
      quantity = Math.max(0, maxSideQuantity - totalBidGenerated);
    }
    if (quantity <= 0) break;
    totalBidGenerated += quantity;

    const safeBidPrice = Math.max(0.0000001, bidPrice);
    bids.push({
      price: safeBidPrice,
      quantity,
      total: safeBidPrice * quantity,
      isPlayer: false, // 市场生成的订单
    });

    bidPrice *= (1 - effectiveDepth * (0.4 + Math.random() * 0.4));
    if (bidPrice < 0.0000001) bidPrice = 0.0000001;
  }

  // ========== 生成卖盘（卖一到卖十） ==========
  let askPrice = basePrice * (1 + 0.002); // 卖一价略高于当前价
  let totalAskGenerated = 0;
  const maxTotalAskQuantity = maxSideQuantity * sellDecayFactor;
  for (let i = 0; i < 10; i++) {
    // 按 10 档权重从单边总深度摊分，并叠加持仓流动性系数与卖盘衰减
    let quantity = (askLevelBases[i] ?? 0) * liquidityFactor * sellDecayFactor * (0.85 + Math.random() * 0.3);
    quantity = Math.min(quantity, maxSingleLevelQuantity);
    if (totalAskGenerated + quantity > maxTotalAskQuantity) {
      quantity = Math.min(quantity, Math.max(0, maxTotalAskQuantity - totalAskGenerated));
    }
    quantity = Math.max(quantity, askLevelFloorQuantity);
    totalAskGenerated += quantity;

    const safeAskPrice = Math.max(0.0000001, askPrice);
    asks.push({
      price: safeAskPrice,
      quantity,
      total: safeAskPrice * quantity,
      isPlayer: false, // 市场生成的订单
    });

    askPrice *= (1 + effectiveDepth * (0.4 + Math.random() * 0.4));
  }

  // ========== 订单量缩减（与回合滚动生成一致：分开应用 orderScale / bidScale / askScale） ==========
  const effBidScale = orderScale * bidScale;
  const effAskScale = orderScale * askScale;
  if (effBidScale !== 1) {
    bids.forEach(bid => {
      bid.quantity *= effBidScale;
      bid.total = bid.price * bid.quantity;
    });
  }
  if (effAskScale !== 1) {
    asks.forEach(ask => {
      ask.quantity *= effAskScale;
      ask.total = ask.price * ask.quantity;
    });
  }

  // 计算总买盘和总卖盘
  const totalBidQuantity = bids.reduce((sum, b) => sum + b.quantity, 0);
  const totalAskQuantity = asks.reduce((sum, a) => sum + a.quantity, 0);

  // 当前价格 = 买一价（最高买入价）
  const lastPrice = bids[0] ? bids[0].price : basePrice;

  // 根据tier确定高低价浮动范围（与K线高低价浮动范围一致）
  const tier = getMechanicsTier(token);
  const { floatMin: highLowFloatMin, floatMax: highLowFloatMax } = getTierHighLowFloatRange(tier);

  // 高低价独立随机生成，不与盘口价格关联
  let highPrice: number, lowPrice: number;
  if (prevCandle) {
    highPrice = prevCandle.high;
    lowPrice = prevCandle.low;
  } else {
    // 无历史K线时，基于当前价格独立随机生成高低价
    const highFloat = highLowFloatMin + Math.random() * (highLowFloatMax - highLowFloatMin);
    const lowFloat = highLowFloatMin + Math.random() * (highLowFloatMax - highLowFloatMin);
    highPrice = basePrice * (1 + highFloat);
    lowPrice = basePrice * (1 - lowFloat);
  }

  return {
    tokenId: token.id, // 添加tokenId用于AI交易识别
    bids,
    asks,
    lastPrice,
    highPrice,
    lowPrice,
    volatilityMultiplier: volatility * (1 + holdingRatio * 3), // 持仓占比越高波动越大
    totalBidQuantity,
    totalAskQuantity,
  };
}

/**
 * 下一周期盘口生成 - 平衡版
 * 
 * 核心规则：
 * 1. 【关键修复】先生成订单前，用上一回合盘口与玩家限价单撮合（以已存在挂单价格成交）
 * 2. 基础盘口保持相对平衡（买卖盘比例在 0.5-2 之间）
 * 3. 价格趋势影响：上涨时卖压适度增加，下跌时买盘适度增加
 * 4. 阻尼机制：限制单周期买卖盘倍数变化范围（0.6-1.5）
 * 5. 深度平衡：确保买卖盘总量不会过度失衡
 * 6. 价格锚定：盘口价格围绕当前价格合理分布
 * 7. 价格回归机制：当流通量无变化但价格异常偏离初始价格时，增加反向订单使价格回归
 * 
 * 【有效市值机制】
 * 盘口生成的订单数量根据有效市值计算，而非总市值
 * 有效市值 = 总市值 * (1 - 玩家持仓占比 - AI交易员持仓占比 - 做市商持仓占比)
 * 例如：总量100M，价格1，市值100M，玩家持仓20%，AI交易员10%，做市商10%
 * 则有效市值 = 100M * (1 - 20% - 10% - 10% - 30%) = 30M
 */
export function generateNextPeriodOrderBook(
  token: Token,
  prevOrderBook: Level2OrderBook | null,
  newCandle: Candle,
  playerLimitOrders: Order[],
  playerHoldings: number,
  heat: number = 50, // 热度值：0-100，影响订单生成数量
  currentRound: number = 0, // 当前全局回合数，用于计算回合涨幅（hourlyPrices存储全局回合数）
  fundingRateMultiplier: number = 0, // 资金费率套利系数，正费率增加现货买盘，负费率增加现货卖盘
  marketingEffect: 'fomo' | 'panic' | null = null, // 营销效果：FOMO增加买单，恐慌增加卖单
  cumulativeChange: number = 0, // 累计涨跌幅（连续上涨/下跌时从起始价格到当前价格的总涨跌幅），用于影响下回合盘口生成
  isHotSectorToken: boolean = false, // 是否为热点板块代币（每3回合盘口基准价格+2%）
  aiHoldingRatio: number = 0, // AI角色（交易员+巨鲸）持仓占比
  playerReservedRatio: number = 0, // 玩家发行时自留代币比例（用于涨幅/跌幅加速计算）
  marketMakerHoldingRatio: number = 0, // 做市商持仓占比（用于有效市值计算）
  eventPriceMultiplier: number = 1, // 市场事件价格乘数（利多>1上涨、利空<1下跌）
  eventUpProbability: number | null = null, // 市场事件概率偏向：公布后24回合内每回合上涨概率（null=50/50随机）
  forcePriceLinkage: boolean = false, // 强制价格联动：做市商正在做市该代币或CEX/DEX价差超过10%时，即使无玩家挂单也按盘口价格模式生成
  orderScale: number = 1, // 盘口订单量缩放系数（观察标签代币为0.5，CEX盘口订单生成减少50%）
  bidScale: number = 1, // 买盘订单量独立缩放系数（即将下架期间为0.5，买单生成减少50%）
  askScale: number = 1, // 卖盘订单量独立缩放系数（即将下架期间为2，卖单生成增加100%）
  availableAskLiquidity?: number, // 【库存守恒】市场可挂卖的真实可用库存 = cexReserve − 玩家 cexBalance − AI/做市商持仓；缺省时回退为 cexReserve
): Level2OrderBook {
  // ========== 关键修复：先生成订单前，用上一回合盘口与玩家限价单撮合 ==========
  // 记录玩家订单的成交详情 (orderId -> { totalQty, totalCost })
  const playerFillDetails: Record<string, { totalQty: number; totalCost: number }> = {};
  // 【AI宏观套利】AI 套利限价单成交明细
  
  // 复制上一回合的盘口用于撮合
  let prevBids: OrderBookEntry[] = [];
  let prevAsks: OrderBookEntry[] = [];
  
  if (prevOrderBook) {
    prevBids = prevOrderBook.bids.filter(b => !b.isPlayer).map(b => ({ ...b }));
    prevAsks = prevOrderBook.asks.filter(a => !a.isPlayer).map(a => ({ ...a }));
  }
  
  // 先用上一回合的市场盘口与玩家限价单撮合
  // 这样成交价格是已存在挂单的价格，而不是新生成订单的价格
  const playerBuyOrders = playerLimitOrders.filter(o => o.side === 'buy' && o.status === 'pending');
  const playerSellOrders = playerLimitOrders.filter(o => o.side === 'sell' && o.status === 'pending');
  
  // 记录玩家订单的剩余数量
  const playerRemainingQty: Record<string, number> = {};
  playerBuyOrders.forEach(order => {
    playerRemainingQty[order.id] = order.quantity - order.filledQuantity;
  });
  playerSellOrders.forEach(order => {
    playerRemainingQty[order.id] = order.quantity - order.filledQuantity;
  });
  
  // 撮合玩家买单与上一回合的卖盘（以卖盘价格成交）
  playerBuyOrders.forEach(order => {
    let remainingQty = playerRemainingQty[order.id];
    if (remainingQty <= 0) return;
    
    // 遍历上一回合的卖盘，找到价格 <= 玩家买单价格的卖单
    for (let i = 0; i < prevAsks.length && remainingQty > 0; i++) {
      const ask = prevAsks[i];
      if (ask.price <= order.price) {
        const fillQty = Math.min(remainingQty, ask.quantity);
        if (fillQty > 0) {
          if (!playerFillDetails[order.id]) {
            playerFillDetails[order.id] = { totalQty: 0, totalCost: 0 };
          }
          playerFillDetails[order.id].totalQty += fillQty;
          playerFillDetails[order.id].totalCost += fillQty * ask.price; // 以已存在卖单价格成交
          
          remainingQty -= fillQty;
          ask.quantity -= fillQty;
          playerRemainingQty[order.id] = remainingQty;
        }
      }
    }
  });
  
  // 撮合玩家卖单与上一回合的买盘（以买盘价格成交）
  playerSellOrders.forEach(order => {
    let remainingQty = playerRemainingQty[order.id];
    if (remainingQty <= 0) return;
    
    // 遍历上一回合的买盘，找到价格 >= 玩家卖单价格的买单
    for (let i = 0; i < prevBids.length && remainingQty > 0; i++) {
      const bid = prevBids[i];
      if (bid.price >= order.price) {
        const fillQty = Math.min(remainingQty, bid.quantity);
        if (fillQty > 0) {
          if (!playerFillDetails[order.id]) {
            playerFillDetails[order.id] = { totalQty: 0, totalCost: 0 };
          }
          playerFillDetails[order.id].totalQty += fillQty;
          playerFillDetails[order.id].totalCost += fillQty * bid.price; // 以已存在买单价格成交
          
          remainingQty -= fillQty;
          bid.quantity -= fillQty;
          playerRemainingQty[order.id] = remainingQty;
        }
      }
    }
  });
  
  // 清理上一回合盘口中数量为0的订单
  prevBids = prevBids.filter(b => b.quantity > 0.001);
  prevAsks = prevAsks.filter(a => a.quantity > 0.001);
  
  // ========== 热点板块价格加成 ==========
  // 热点板块代币每3回合盘口基准价格+2%（仅盘口价格模式生效）
  // 注意：买盘数量加成已移除，改为价格加成
  // 【修复波动率异常】纯随机模式下该加成会被置为1.0，改为在随机步长内
  // 按tier波动范围向上偏多，避免巨鲸代币单回合波动被固定+2%推高到约2%
  let hotSectorPriceBonus = isHotSectorToken && currentRound % 3 === 0 ? 1.02 : 1.0;
  
  // ========== 基础参数计算 ==========
  const prevPrice = prevOrderBook?.lastPrice || token.initialPrice;
  const safePrevPrice = prevPrice > 0.0001 ? prevPrice : 0.0001;
  const safeCirculatingSupply = token.circulatingSupply > 0.0001 ? token.circulatingSupply : 0.0001;
  
  // 清理上一回合盘口中数量为0的订单
  prevBids = prevBids.filter(b => b.quantity > 0.001);
  prevAsks = prevAsks.filter(a => a.quantity > 0.001);
  
  // ========== 开始生成新盘口 ==========
  const bids: OrderBookEntry[] = [];
  const asks: OrderBookEntry[] = [];
  
  // 计算玩家持仓占比
  const holdingRatio = playerHoldings / safeCirculatingSupply;
  
  // ========== 有效市值机制 ==========
  // 盘口生成的订单数量根据有效市值计算，而非使用卖盘因子
  // 有效市值 = 总市值 * 已解锁比例 * (1 - 玩家持仓占比 - AI交易员持仓占比 - 做市商持仓占比)
  // 已解锁比例 = 流通量 / 总量（或 (总量 - 未解锁量) / 总量）
  // 注意：玩家自留代币已经包含在玩家持仓中，不需要额外扣除
  // 
  // 例如：总量100M，价格1，市值100M，已解锁50%
  // 玩家持仓占流通20%，AI交易员持仓占比10%，做市商持仓占比10%，DEX流动性池内代币占流通30%
  // 则有效市值 = 100M * 50% * (1 - 20% - 10% - 10% - 30%) = 15M
  // 
  // 【重要】不修改显示的市值，仅修改盘口生成时根据的市值
  const totalSupply = token.totalSupply > 0 ? token.totalSupply : safeCirculatingSupply;
  const unlockedRatio = token.unvestedSupply && token.unvestedSupply > 0
    ? Math.max(0.0001, (totalSupply - token.unvestedSupply) / totalSupply)
    : 1; // 无未解锁量时，已解锁比例为100%
  const playerMarketHoldingRatio = Math.max(0, holdingRatio - playerReservedRatio); // 玩家市场持仓占比（扣除自留）
  const nonMarketHoldingRatio = Math.min(0.9999, playerMarketHoldingRatio + aiHoldingRatio + marketMakerHoldingRatio);
  const effectiveMarketCapRatio = Math.max(0.0001, 1 - nonMarketHoldingRatio); // 有效市值比例
  const effectiveMarketCap = token.marketCap * unlockedRatio * effectiveMarketCapRatio; // 有效市值
  
  // ========== 盘口深度模型：USDT 单边总深度（与合约同口径） ==========
  // 单边总深度（USDT）= 流通市值 × 0.02% + 5000U 底仓 + (热度/100) × 30万U
  // 说明：废弃旧的「有效供应 × 百分比」口径，改为绝对资金深度；
  // 有效市值仍保留给「市值回归机制」使用，不再参与基础订单量计算。
  const sideDepthPrice = newCandle.close > 0 ? newCandle.close : token.currentPrice;
  const sideDepth = computeSideDepth({
    circulatingSupply: safeCirculatingSupply,
    totalSupply: token.totalSupply,
    price: sideDepthPrice,
    heat,
  });
  const {
    bidLevelBases: spotBidLevelBases,
    askLevelBases: spotAskLevelBases,
  } = computeWeightedLevelBases(sideDepth.totalDepthTokens, 10, 0.12, 0.15);
  // 单档 / 单边总量上限（不再使用有效供应）
  const maxSingleLevelQuantity = sideDepth.totalDepthTokens * 0.2;
  const maxSideQuantity = sideDepth.totalDepthTokens * 1.5;
  
  // ========== 涨幅/跌幅加速机制：已移除 ==========
  // 【修复】移除此机制，因为它会导致正反馈循环，使价格异常暴涨或暴跌
  // 
  // 问题分析：
  // 当持仓占比增加时（deltaX > 0），价格会加速上涨（accelerationMultiplier = 1 + deltaX）
  // 价格上涨会导致DEX流动性池价格被拉动上涨
  // 价格变化会影响后续持仓占比与有效市值计算
  // 形成无法停止的正反馈循环
  // 
  // 例如：上回合持仓占比20%，本回合70%，deltaX=50%
  // 则下回合所有订单价格提升50%，导致价格暴涨
  // 
  // 移除后，价格完全由盘口供需决定，不再受持仓占比变化的直接影响
  let accelerationMultiplier = 1; // 价格加速倍数固定为1
  
  // 计算价格变化幅度
  const priceChangePercent = ((newCandle.close - safePrevPrice) / safePrevPrice) * 100;
  
  // 资金费率套利吃单量基准：买一档基础量
  const baseOrderQuantity = spotBidLevelBases[0] || 0;
  
  // ========== 热度机制 ==========
  // 热度不再作为 0.5~2.0 的乘法系数，而是作为绝对资金增量计入单边总深度（见上方 sideDepth）
  
  // 根据市值确定订单深度
  let depthPercent = 0.03;
  if (token.marketCap > 500000000) depthPercent = 0.01;
  else if (token.marketCap > 100000000) depthPercent = 0.02;
  else if (token.marketCap < 1000000) depthPercent = 0.05;
  
  // ========== 平衡版：温和的价格趋势影响 ==========
  // 价格趋势影响买卖盘数量，无上限限制
  let sellMultiplier = 1;
  let buyMultiplier = 1;
  
  if (priceChangePercent > 0) {
    // 价格上涨：卖单增加，买单减少
    // 使用对数函数平滑影响
    const trendFactor = Math.log(1 + priceChangePercent / 10) / Math.log(2);
    sellMultiplier = 1 + trendFactor * 0.2;
    buyMultiplier = Math.max(0.15, 1 - trendFactor * 0.1); // 最小保留15%，防止买盘完全消失
  } else if (priceChangePercent < 0) {
    // 价格下跌：买单增加，卖单减少
    const trendFactor = Math.log(1 + Math.abs(priceChangePercent) / 10) / Math.log(2);
    buyMultiplier = 1 + trendFactor * 0.2;
    sellMultiplier = Math.max(0.15, 1 - trendFactor * 0.1); // 最小保留15%，防止卖盘完全消失
  }
  
  // ========== 价格回归机制（基于有效市值） ==========
  // 当有效市值异常偏离初始有效市值时，增加反向订单使价格回归
  // 【修复】从偏离初始价格改为偏离初始有效市值
  // 
  // 原因：价格回归应该基于市值而非价格，因为市值更能反映代币的真实价值
  // 例如：代币销毁后流通量减少，价格上涨是合理的，不应触发回归
  // 
  // 初始有效市值 = initialMarketCap * 初始已解锁比例 * (1 - 初始非市场持仓占比)
  // 初始时假设玩家、AI、做市商持仓都为0，DEX池占比由初始分配决定
  
  const initialMarketCap = token.initialMarketCap || token.marketCap;
  const currentPrice = newCandle.close;
  
  // 计算初始有效市值（发行时的有效市值）
  // 初始时：玩家持仓=0, AI持仓=0, 做市商持仓=做市商初始分配比例, DEX池占比=流动性池初始分配比例
  const initialUnlockedRatio = token.unvestedSupply && token.unvestedSupply > 0
    ? Math.max(0.0001, (token.totalSupply - token.unvestedSupply) / token.totalSupply)
    : 1;
  // 初始非市场持仓占比 = 做市商初始分配比例 + DEX流动性池初始分配比例
  // 注意：初始时玩家和AI持仓为0
  const initialMarketMakerRatio = (token.marketMakerPercent || 0) / 100;
  const initialDexPoolRatio = (token.liquidityPercent || 0) / 100;
  const initialNonMarketHoldingRatio = Math.min(0.9999, initialMarketMakerRatio + initialDexPoolRatio);
  const initialEffectiveMarketCapRatio = Math.max(0.0001, 1 - initialNonMarketHoldingRatio);
  const initialEffectiveMarketCap = initialMarketCap * initialUnlockedRatio * initialEffectiveMarketCapRatio;
  
  // 当前有效市值已在上方计算（effectiveMarketCap）
  const currentEffectiveMarketCap = effectiveMarketCap;
  
  // 计算有效市值偏离初始有效市值的幅度
  const safeInitialEffectiveMarketCap = initialEffectiveMarketCap > 0 ? initialEffectiveMarketCap : 0.0001;
  const deviationFromInitial = (currentEffectiveMarketCap - safeInitialEffectiveMarketCap) / safeInitialEffectiveMarketCap;
  
  // 【小市值代币修复】根据代币tier设置不同的有效市值回归阈值
  // 价格回归机制触发阈值统一提升5%
  const tier = getMechanicsTier(token);
  let marketCapDeviationThreshold = 0.20; // 默认20%偏离触发
  let baseReversionCoefficient = 2.5; // 默认回归系数基数（降低以减少过度回归）
  
  if (tier === 1) {
    // 微型代币：15%偏离触发（原10%+5%）
    marketCapDeviationThreshold = 0.15;
    baseReversionCoefficient = 3;
  } else if (tier === 2) {
    // 小型代币：17%偏离触发（原12%+5%）
    marketCapDeviationThreshold = 0.17;
    baseReversionCoefficient = 2.8;
  } else if (tier === 3) {
    // 中型代币：20%偏离触发（原15%+5%）
    marketCapDeviationThreshold = 0.20;
    baseReversionCoefficient = 2.5;
  } else if (tier === 4) {
    // 大型代币：22%偏离触发
    marketCapDeviationThreshold = 0.22;
    baseReversionCoefficient = 2.3;
  } else if (tier === 5) {
    // 巨型代币：25%偏离触发
    marketCapDeviationThreshold = 0.25;
    baseReversionCoefficient = 2.0;
  } else if (tier === 6) {
    // 巨鲸代币：28%偏离触发
    marketCapDeviationThreshold = 0.28;
    baseReversionCoefficient = 1.8;
  }
  
  // 价格回归系数：用于调整反向订单数量
  let priceReversionMultiplier = 0;
  
  // 记录价格偏离程度，供深度平衡机制使用
  let priceDeviationMagnitude = 0;
  
  if (Math.abs(deviationFromInitial) > marketCapDeviationThreshold) {
    // 有效市值异常偏离，需要回归
    // 偏离越大，回归力度越强
    priceDeviationMagnitude = Math.abs(deviationFromInitial);
    
    // 使用指数回归系数，偏离越大回归越强
    // 回归系数 = 基础系数 * (偏离幅度 - 阈值)^1.2
    priceReversionMultiplier = Math.min(3.5, baseReversionCoefficient * Math.pow(priceDeviationMagnitude - marketCapDeviationThreshold, 1.2) + 0.3);
    
    // 极端偏离额外回归加成：偏离超过50%时，额外增加回归力度
    if (priceDeviationMagnitude > 0.5) {
      priceReversionMultiplier += (priceDeviationMagnitude - 0.5) * 1.5;
    }
    
    if (deviationFromInitial > 0) {
      // 有效市值高于初始值（溢价），增加卖单（卖压）使价格下跌
      sellMultiplier *= (1 + priceReversionMultiplier * 1.0);
      // 最小保留15%，防止买盘完全消失
      buyMultiplier = Math.max(0.15, buyMultiplier * (1 - priceReversionMultiplier * 0.3));
    } else {
      // 有效市值低于初始值（折价），增加买单（买盘支撑）使价格上涨
      buyMultiplier *= (1 + priceReversionMultiplier * 1.2);
      // 最小保留15%，防止卖盘完全消失
      sellMultiplier = Math.max(0.15, sellMultiplier * (1 - priceReversionMultiplier * 0.4));
    }
  }
  
  // ========== 计算盘口剩余订单的买卖盘数量比 ==========
  // 用于平衡订单生成价格
  const prevBidTotal = prevBids.reduce((sum, b) => sum + b.quantity, 0);
  const prevAskTotal = prevAsks.reduce((sum, a) => sum + a.quantity, 0);
  const prevBidAskRatio = prevBidTotal / Math.max(prevAskTotal, 0.001);
  
  // 根据盘口剩余订单数量比计算价格调整因子
  // 如果买盘多于卖盘，卖盘价格应该更接近当前价（更容易成交），买盘价格应该更远离当前价
  // 如果卖盘多于买盘，买盘价格应该更接近当前价，卖盘价格应该更远离当前价
  let bidPriceAdjustFactor = 1; // 买盘价格间距因子
  let askPriceAdjustFactor = 1; // 卖盘价格间距因子
  
  if (prevBidAskRatio > 1.5) {
    // 买盘明显多于卖盘，调整价格使卖盘更易成交
    // 卖盘价格更接近当前价，买盘价格更远离当前价
    askPriceAdjustFactor = 0.4 + Math.random() * 0.4; // 卖盘价格间距缩小 [0.4, 0.8]
    bidPriceAdjustFactor = 1.2 + Math.random() * 0.4; // 买盘价格间距扩大 [1.2, 1.6]
  } else if (prevBidAskRatio < 0.67) {
    // 卖盘明显多于买盘，调整价格使买盘更易成交
    // 买盘价格更接近当前价，卖盘价格更远离当前价
    bidPriceAdjustFactor = 0.4 + Math.random() * 0.4; // 买盘价格间距缩小 [0.4, 0.8]
    askPriceAdjustFactor = 1.2 + Math.random() * 0.4; // 卖盘价格间距扩大 [1.2, 1.6]
  }
  
  // ========== 套利机制调整（指数级增强版）============
  // 资金费率影响现货市场买卖盘数量
  // 正费率：套利者买入现货、做空合约，现货买盘增加
  // 负费率：套利者卖出现货、做多合约，现货卖盘增加
  // 
  // 关键增强：当资金费率达到±1%以上时，套利强度呈指数级增长
  // 通过主动吃单加快现货与合约价格的收敛速度
  const arbitrageMultiplier = Math.abs(fundingRateMultiplier);
  
  // 现货市场套利调整
  let spotBidMultiplier = 1; // 现货买盘系数
  let spotAskMultiplier = 1; // 现货卖盘系数
  
  // ========== 指数级套利强度计算 ============
  // 当资金费率 < 0.2% 时：线性增长
  // 当资金费率 >= 0.2% 时：指数级增长
  let ARBITRAGE_AMPLIFICATION = 0;
  let ARBITRAGE_EAT_FACTOR = 0;
  
  if (arbitrageMultiplier > 0) {
    if (arbitrageMultiplier < 0.002) {
      // 资金费率 < 0.2%：线性增长，基础系数为 5
      ARBITRAGE_AMPLIFICATION = 5;
      ARBITRAGE_EAT_FACTOR = 6;
    } else {
      // 资金费率 >= 0.2%：指数级增长
      // 基础强度 + 指数增强
      // 当费率为0.2%时，强度为 5 + 0 = 5
      // 当费率为1%时，强度为 5 + 40 = 45
      // 当费率为2%时，强度为 5 + 90 = 95
      // 当费率为3%时，强度为 5 + 140 = 145
      // 当费率为5%时，强度为 5 + 240 = 245
      const excessRate = arbitrageMultiplier - 0.002; // 超过0.2%的部分
      const exponentialFactor = excessRate * 1000; // 指数因子
      ARBITRAGE_AMPLIFICATION = 5 + exponentialFactor;
      ARBITRAGE_EAT_FACTOR = 6 + exponentialFactor * 1.5; // 吃单系数更强
    }
  }
  
  // 现货价格变化趋势
  const spotPriceChange = safePrevPrice > 0 ? (newCandle.close - safePrevPrice) / safePrevPrice : 0;
  
  // ========== 套利吃单机制 ==========
  // 记录套利吃单量（用于返回给调用方）
  let arbitrageEatQuantity = 0;
  
  if (fundingRateMultiplier > 0) {
    // 正费率：合约价格 > 现货价格，套利者买入现货、做空合约
    // 现货端：主动买入（吃掉卖盘），推高现货价格
    
    let amplificationFactor = ARBITRAGE_AMPLIFICATION;
    let eatFactor = ARBITRAGE_EAT_FACTOR;
    
    // 检测现货价格是否正在向合约价格回归（上涨）
    if (spotPriceChange > 0.002) {
      // 现货正在上涨，减弱套利力度
      const reductionFactor = Math.max(0.3, 1 - spotPriceChange * 8);
      amplificationFactor *= reductionFactor;
      eatFactor *= reductionFactor;
    }
    
    spotBidMultiplier = 1 + arbitrageMultiplier * amplificationFactor;
    spotAskMultiplier = Math.max(0.6, 1 - arbitrageMultiplier * amplificationFactor * 0.15);
    
    // 计算套利吃单量：主动买入现货
    arbitrageEatQuantity = baseOrderQuantity * arbitrageMultiplier * eatFactor;
    
    // 执行套利吃单：吃掉卖盘
    if (arbitrageEatQuantity > 0 && prevAsks.length > 0) {
      let remainingEat = arbitrageEatQuantity;
      for (let i = 0; i < prevAsks.length && remainingEat > 0; i++) {
        const ask = prevAsks[i];
        const eatQty = Math.min(remainingEat, ask.quantity);
        if (eatQty > 0) {
          ask.quantity -= eatQty;
          remainingEat -= eatQty;
          // 记录吃单对价格的影响（推高现货价格）
          // 吃掉卖盘后，现货价格会向卖一价靠拢
        }
      }
      // 清理数量为0的卖盘
      prevAsks = prevAsks.filter(a => a.quantity > 0.001);
    }
    
  } else if (fundingRateMultiplier < 0) {
    // 负费率：合约价格 < 现货价格，套利者做多合约、卖出现货
    // 现货端：主动卖出（吃掉买盘），压低现货价格
    
    let amplificationFactor = ARBITRAGE_AMPLIFICATION;
    let eatFactor = ARBITRAGE_EAT_FACTOR;
    
    // 检测现货价格是否正在向合约价格回归（下跌）
    if (spotPriceChange < -0.002) {
      // 现货正在下跌，减弱套利力度
      const reductionFactor = Math.max(0.3, 1 + spotPriceChange * 8);
      amplificationFactor *= reductionFactor;
      eatFactor *= reductionFactor;
    }
    
    spotAskMultiplier = 1 + arbitrageMultiplier * amplificationFactor;
    spotBidMultiplier = Math.max(0.6, 1 - arbitrageMultiplier * amplificationFactor * 0.15);
    
    // 计算套利吃单量：主动卖出现货
    arbitrageEatQuantity = baseOrderQuantity * arbitrageMultiplier * eatFactor;
    
    // 执行套利吃单：吃掉买盘
    if (arbitrageEatQuantity > 0 && prevBids.length > 0) {
      let remainingEat = arbitrageEatQuantity;
      for (let i = 0; i < prevBids.length && remainingEat > 0; i++) {
        const bid = prevBids[i];
        const eatQty = Math.min(remainingEat, bid.quantity);
        if (eatQty > 0) {
          bid.quantity -= eatQty;
          remainingEat -= eatQty;
          // 记录吃单对价格的影响（压低现货价格）
          // 吃掉买盘后，现货价格会向买一价靠拢
        }
      }
      // 清理数量为0的买盘
      prevBids = prevBids.filter(b => b.quantity > 0.001);
    }
  }

  // ========== 营销效果调整 ==========
  // FOMO：买单生成提升50%
  // 恐慌：卖单生成提升50%
  if (marketingEffect === 'fomo') {
    // 制造FOMO：买盘增加50%
    spotBidMultiplier *= 1.5;
  } else if (marketingEffect === 'panic') {
    // 制造恐慌：卖盘增加50%
    spotAskMultiplier *= 1.5;
  }

  // ========== 涨跌幅影响盘口机制 ==========
  // 【增强版】涨跌幅同时影响买卖双方
  // 【连续涨跌追踪】使用累计涨跌幅而非单回合涨跌幅
  // 连续上涨时：使用从连续上涨起始第一回合到当前回合的总涨幅
  // 连续下跌时：使用从连续下跌起始第一回合到当前回合的总跌幅
  // 上涨时：卖单增加（获利盘抛压）+ 买单减少（买方观望）
  // 下跌时：买单增加（抄底盘支撑）+ 卖单减少（卖方惜售）
  let priceSpreadAdjust = 0; // 价格间距调整系数
  
  if (cumulativeChange > 0) {
    // 累计上涨
    // 1. 卖单增加：涨幅x%时，卖单增加x%
    spotAskMultiplier *= (1 + cumulativeChange);
    // 2. 买单减少：减少百分比 = 1 - 1/(涨幅+1)，即买单乘以 1/(涨幅+1)
    // 涨幅10%时，买单减少约9.1%；涨幅50%时，买单减少约33.3%
    // 最小保留10%，防止高涨幅时买盘完全消失
    spotBidMultiplier = Math.max(0.1, spotBidMultiplier * (1 / (1 + cumulativeChange)));
    // 3. 价格间距调整：涨幅越大，卖盘价格间距越大（卖方预期更高价格）
    priceSpreadAdjust = cumulativeChange * 0.05;
    askPriceAdjustFactor *= (1 + priceSpreadAdjust);
    bidPriceAdjustFactor *= (1 + priceSpreadAdjust * 0.5);
  } else if (cumulativeChange < 0) {
    // 累计下跌（增强支撑力度）
    // cumulativeChange是负数，如-0.05表示下跌5%
    // 1. 买单增加（增强版）：跌幅y%时买单增加更多
    // 跌幅10%时，买单增加约20%；跌幅30%时，买单增加约60%；跌幅50%时，买单增加约100%
    const declineRatio = Math.abs(cumulativeChange);
    const bidIncreaseFactor = 1 + declineRatio * 2; // 增强买单支撑
    spotBidMultiplier *= bidIncreaseFactor;
    // 2. 卖单减少（增强版）：跌幅越大，卖单减少越多
    // 跌幅10%时，卖单减少15%；跌幅30%时，卖单减少35%；跌幅50%时，卖单减少50%
    // 最小保留10%，防止卖盘完全消失
    spotAskMultiplier = Math.max(0.1, spotAskMultiplier * Math.max(0.3, 1 - declineRatio));
    // 3. 价格间距调整：跌幅越大，买盘价格间距越大（买方预期更低价格）
    priceSpreadAdjust = declineRatio * 0.05;
    bidPriceAdjustFactor *= (1 + priceSpreadAdjust);
    askPriceAdjustFactor *= (1 + priceSpreadAdjust * 0.5);
  }
  
  // ========== 判断CEX盘口是否存在玩家挂单 ==========
  // 计算玩家买单加权平均价格（使用剩余数量）
  const playerBuyOrdersWithRemaining = playerBuyOrders.filter(o => (playerRemainingQty[o.id] || 0) > 0);
  const playerSellOrdersWithRemaining = playerSellOrders.filter(o => (playerRemainingQty[o.id] || 0) > 0);
  
  // 判断是否存在玩家挂单（买单或卖单有剩余数量）
  const hasPlayerOrders = playerBuyOrdersWithRemaining.length > 0 || playerSellOrdersWithRemaining.length > 0;
  
  let playerBidWeightedPrice = 0;
  let playerBidTotalQuantity = 0;
  playerBuyOrdersWithRemaining.forEach(order => {
    const remainingQty = playerRemainingQty[order.id] || 0;
    if (remainingQty > 0) {
      playerBidWeightedPrice += order.price * remainingQty;
      playerBidTotalQuantity += remainingQty;
    }
  });
  if (playerBidTotalQuantity > 0) {
    playerBidWeightedPrice /= playerBidTotalQuantity;
  }
  
  // 计算玩家卖单加权平均价格（使用剩余数量）
  let playerAskWeightedPrice = 0;
  let playerAskTotalQuantity = 0;
  playerSellOrdersWithRemaining.forEach(order => {
    const remainingQty = playerRemainingQty[order.id] || 0;
    if (remainingQty > 0) {
      playerAskWeightedPrice += order.price * remainingQty;
      playerAskTotalQuantity += remainingQty;
    }
  });
  if (playerAskTotalQuantity > 0) {
    playerAskWeightedPrice /= playerAskTotalQuantity;
  }
  
  // ========== 价格基准计算（根据是否存在玩家挂单区分） ==========
  // 【关键修改】当CEX盘口不存在玩家挂单时，价格改为纯随机波动
  // 与CEX买一价、DEX价格、合约价格均无关
  let cexBasePrice: number;
  
  if (!hasPlayerOrders && !forcePriceLinkage) {
    // ========== 无玩家挂单且无做市商做市且价差未超限：纯随机波动模式 ==========
    // 价格完全由随机波动决定，不受任何外部价格影响
    // 【修复规律性锯齿】盘口基准价改用本回合 K 线收盘价（newCandle.close），
    // 不再使用上一回合盘口 lastPrice。原因：纯随机模式下上一回合盘口 lastPrice
    // 会被覆盖为 finalPrice（= 上上回合收盘价 × 随机波动），导致本回合 K 线收盘价
    // 只与"隔一根"的 K 线相关，奇偶两根 K 线各自独立随机游走，交织显示成
    // "一回合涨一回合跌、幅度几乎相同"的规律性锯齿。改用本回合收盘价后，
    // 每根 K 线只依赖上一根，恢复正常的单链随机游走。
    // 【修复波动率异常】纯随机模式单回合总波动只施加一次tier随机步长：
    // 盘口基准价直接以本回合开盘价（= 上一回合收盘价）为基准计算，
    // 不再叠加 calculateNextCandle 中的第二次随机步长。原实现双随机叠加
    // 会把巨鲸代币单回合波动放大到 ±0.4%，超出 0.1%-0.2% 的tier契约
    const prevCloseRef = newCandle.open > 0.0001 ? newCandle.open : 0.0001;
    
    // 根据tier确定波动率范围（含随机波动加成）
    // tier 1(微型): 2%-5%, tier 2(小型): 1%-3%, tier 3(中型): 0.5%-2%
    // tier 4(大型): 0.3%-1%, tier 5(巨型): 0.2%-0.5%, tier 6(巨鲸): 0.1%-0.2%
    const { volMin: bookBaseMin, volMax: bookBaseMax } = getTierVolatilityRange(getMechanicsTier(token));
    const bookBaseVolBoost = token.volBoostPct || 0;
    const effBookBaseMin = bookBaseMin + bookBaseVolBoost;
    const effBookBaseMax = bookBaseMax + bookBaseVolBoost;
    const volatility = effBookBaseMin + Math.random() * (effBookBaseMax - effBookBaseMin);
    // 【修复波动率异常】热板块回合：方向强制向上，但幅度仍受tier波动范围约束
    // （原固定+2%加成会把巨鲸代币单回合波动推高到约2%，超出tier契约）
    // 事件窗口内仍按事件上涨概率偏向（默认50/50）
    const isHotRound = isHotSectorToken && currentRound % 3 === 0;
    const direction = isHotRound ? 1 : (eventUpProbability != null ? (Math.random() < eventUpProbability ? 1 : -1) : (Math.random() > 0.5 ? 1 : -1));
    const change = direction * volatility;
    // 纯随机波动，不受CEX买一价、DEX价格、合约价格影响
    cexBasePrice = prevCloseRef * (1 + change);
    // 热板块+2%加成已并入上方随机步长（方向偏多），此处不再叠加
    hotSectorPriceBonus = 1.0;
  } else {
    // ========== 盘口价格模式（有玩家挂单/做市商正在做市/CEX-DEX价差超过10%） ==========
    // CEX 盘口生成基准价格仅参考 K 线收盘价（不再参考 DEX 价格）
    cexBasePrice = newCandle.close;
    
    // 玩家限价单影响基准价格（仅限高于当前市价的买单）
    // 【修复】玩家卖单不得影响基准价格：高价卖单只是意向报价，未成交前不应推动市场价格
    // 之前卖单价格也会按30%权重拉入基准价，导致"当前价格1，挂1000的限价卖单，价格飞涨往1000靠"
    // 修复后只有高于当前市价的买单（主动买盘）才允许推动价格，这是庄家买入的正常机制
    // 低于市价的买单属于被动挂单，同样不参与基准价计算，避免反向拖拽价格
    let playerLimitPrice = 0;
    if (playerBidTotalQuantity > 0) {
      // 仅当买单加权平均价高于当前基准价格时，买单才影响基准价格
      if (playerBidWeightedPrice > cexBasePrice) {
        playerLimitPrice = playerBidWeightedPrice;
      }
    }
    
    // 玩家高于市价的买单按100%权重抬升基准价（低于市价的买单和所有卖单不参与）
    if (playerLimitPrice > 0) {
      cexBasePrice = playerLimitPrice;
    }
    
    // 随机波动机制（与初始化K线一致）
    // 本回合基准价格在上回合基准价格上浮动
    // 【修复0%波动】随机波动必须在玩家买单抬升基准价之后叠加：
    // 若先随机后抬升，100%权重抬升会直接覆盖随机结果，把基准价钉死在玩家限价单价格上，
    // 导致后续回合波动显示为0%；调整顺序后价格围绕抬升后的基准价继续按tier随机游走
    const prevBasePrice = prevOrderBook?.lastPrice || token.initialPrice;
    if (prevBasePrice > 0) {
      // 根据tier确定波动率范围（含随机波动加成）
      const { volMin: linkBaseMin, volMax: linkBaseMax } = getTierVolatilityRange(getMechanicsTier(token));
      const linkBaseVolBoost = token.volBoostPct || 0;
      const effLinkBaseMin = linkBaseMin + linkBaseVolBoost;
      const effLinkBaseMax = linkBaseMax + linkBaseVolBoost;
      const volatility = effLinkBaseMin + Math.random() * (effLinkBaseMax - effLinkBaseMin);
      // 使用独立的随机数生成方向；事件窗口内按事件上涨概率偏向（默认50/50）
      const direction = eventUpProbability != null ? (Math.random() < eventUpProbability ? 1 : -1) : (Math.random() > 0.5 ? 1 : -1);
      const change = direction * volatility;
      cexBasePrice = cexBasePrice * (1 + change);
    }
  }

  // ========== 生成买盘 ==========
  // 订单生成价格根据盘口剩余订单买卖盘数量比进行平衡
  // 应用热度系数：热度越高，订单数量越多
  // 应用热点板块价格加成：热点板块代币每3回合基准价格+2%
  // 应用涨幅/跌幅加速机制：持仓占比变化时，基准价格相应调整
  // 注意：已移除恐惧贪婪指数对价格的影响机制
  // 【市场事件】事件价格乘数作用于盘口生成基准价格
  // 【下架强平机制】下架当回合：下回合现货盘口生成基准价格调整为残留仓位平均开仓价（仅生效一回合）
  const delistSpotBasePriceOverride = typeof token.delistSpotBasePrice === 'number' && token.delistSpotBasePrice > 0 ? token.delistSpotBasePrice : 0;
  const acceleratedBasePrice = delistSpotBasePriceOverride > 0
    ? delistSpotBasePriceOverride
    : cexBasePrice * accelerationMultiplier * hotSectorPriceBonus * eventPriceMultiplier;
  // 【关键修复】买盘价格不再固定低于基准价格，而是围绕基准价格随机波动
  // 这样可以避免买一价始终低于基准价格导致的系统性下跌偏向
  // 买盘价格在基准价格的 -0.05% 到 +0.05% 之间随机
  const bidPriceRandomFactor = (Math.random() - 0.5) * 0.001; // -0.0005 到 +0.0005
  let bidPrice = acceleratedBasePrice * (1 + bidPriceRandomFactor);
  // 总量上限：单边总代币深度的 1.5 倍
  const maxTotalBidQuantity = maxSideQuantity;
  let totalBidGenerated = 0;
  
  for (let i = 0; i < 10; i++) {
    // 按 10 档权重从单边总深度摊分
    const levelBase = spotBidLevelBases[i] ?? 0;
    // 叠加趋势/回归/套利/FOMO 乘法系数
    let quantity = levelBase * buyMultiplier * (0.85 + Math.random() * 0.3) * spotBidMultiplier;
    
    // 限制单档买盘数量（单档最多占单边总深度的 20%）
    const maxSingleBid = maxSingleLevelQuantity;
    quantity = Math.min(quantity, maxSingleBid);
    
    // 检查总量限制
    if (totalBidGenerated + quantity > maxTotalBidQuantity) {
      quantity = Math.max(0, maxTotalBidQuantity - totalBidGenerated);
    }
    
    if (quantity <= 0) break;
    
    totalBidGenerated += quantity;
    
    // 价格下限为0
    const safeBidPrice = Math.max(0.0000001, bidPrice);
    
    bids.push({
      price: safeBidPrice,
      quantity,
      total: safeBidPrice * quantity,
      isPlayer: false, // 市场生成的订单
    });
    
    // 根据盘口剩余订单数量比调整价格间距
    bidPrice *= (1 - depthPercent * bidPriceAdjustFactor * (0.4 + Math.random() * 0.4));
    // 确保价格不会变成负数
    if (bidPrice < 0.0000001) bidPrice = 0.0000001;
  }
  
  // ========== 生成卖盘 ==========
  // 【卖盘减少机制】根据综合持仓占比使用指数衰减公式减少卖盘数量
  // 当玩家、AI交易员、做市商持仓占比增加时，市场上可卖的筹码减少，卖盘数量应该相应减少
  // 衰减因子 = (1 - 综合持仓占比)^0.5，持仓占比越高，卖盘越少
  // 这模拟了真实市场：当大量筹码被锁定时，卖盘压力自然减少
  const combinedHoldingRatio = Math.min(0.95, holdingRatio + aiHoldingRatio + marketMakerHoldingRatio);
  const sellDecayFactor = Math.pow(1 - combinedHoldingRatio, 0.5); // 指数衰减，持仓占比越高卖盘越少
  
  // 订单生成价格根据盘口剩余订单买卖盘数量比进行平衡
  // 应用热度系数：热度越高，订单数量越多
  // 应用涨幅/跌幅加速机制：持仓占比变化时，基准价格相应调整
  // 【关键修复】卖盘价格不再固定高于基准价格，而是围绕基准价格随机波动
  // 卖盘价格在基准价格的 +0.05% 到 +0.15% 之间随机
  const askPriceRandomFactor = 0.001 + Math.random() * 0.001; // 0.001 到 0.002
  let askPrice = acceleratedBasePrice * (1 + askPriceRandomFactor);
  // 【库存守恒】CEX 卖盘物理上限：市场生成的卖单只能来自平台"可用库存"
  // = cexReserve − 玩家 cexBalance − AI/做市商持仓（玩家自己的限价卖单由其 cexBalance 支撑，不占用该额度）
  const availableAskLiquidityCap = Math.max(0, availableAskLiquidity ?? (token.cexReserve || 0));
  const physicalAskCap = availableAskLiquidityCap;
  const maxTotalAskQuantity = Math.min(
    maxSideQuantity * sellDecayFactor, // 总量上限：单边总深度 1.5 倍 × 卖盘衰减
    physicalAskCap,
  );
  // 【模块一】卖盘深度指数衰减：库存越枯竭，单档挂单量指数级缩减，但始终保留完整 10 档
  // baseReserve 取该代币的总库存；availableRatio = 可用卖盘库存 / 总库存
  const askBaseReserve = Math.max(token.cexReserve || 1, 1);
  const askAvailableRatio = Math.max(0, Math.min(1, availableAskLiquidityCap / askBaseReserve));
  // 指数 1.5：剩余 20% 库存时单档深度约缩减到 9%
  const askDepthDecayFactor = Math.max(1e-5, Math.pow(askAvailableRatio, 1.5));
  // 每档最小数量：保证 10 档永远存在，K 线仍可生成（也不被盘口清理阈值过滤）
  const askLevelFloorQuantity = Math.max(baseOrderQuantity * 1e-5, 0.002);

  let totalAskGenerated = 0;
  
  for (let i = 0; i < 10; i++) {
    // 按 10 档权重从单边总深度摊分
    const levelBase = spotAskLevelBases[i] ?? 0;
    // 叠加趋势/回归/套利/FOMO/卖盘持仓衰减乘法系数
    let quantity = levelBase * sellMultiplier * (0.85 + Math.random() * 0.3) * spotAskMultiplier * sellDecayFactor;
    
    // 限制单档卖盘数量（单档最多占单边总深度的 20%，同时受可用库存约束）
    const maxSingleAsk = Math.min(maxSingleLevelQuantity, physicalAskCap);
    quantity = Math.min(quantity, maxSingleAsk);
    
    // 【模块一】应用指数衰减：库存枯竭时单档数量缩减，但不删除档位
    quantity *= askDepthDecayFactor;
    
    // 总量软限制：超限时只压低本档数量，绝不中断循环（保证 10 档完整）
    if (totalAskGenerated + quantity > maxTotalAskQuantity) {
      quantity = Math.min(quantity, Math.max(0, maxTotalAskQuantity - totalAskGenerated));
    }
    // 保底地板：即使库存为 0 也保留一根极细卖单，避免出现空盘口/无量暴涨
    quantity = Math.max(quantity, askLevelFloorQuantity);
    
    totalAskGenerated += quantity;
    
    // 价格下限为0
    const safeAskPrice = Math.max(0.0000001, askPrice);
    
    asks.push({
      price: safeAskPrice,
      quantity,
      total: safeAskPrice * quantity,
      isPlayer: false, // 市场生成的订单
    });
    
    // 根据盘口剩余订单数量比调整价格间距
    askPrice *= (1 + depthPercent * askPriceAdjustFactor * (0.4 + Math.random() * 0.4));
  }
  
  // ========== CEX买盘最小系数机制已移除 ==========
  // 该机制会导致正反馈循环：价格上涨→市值增加→minBidValue增加→补充买盘→价格继续上涨
  // 移除后，盘口买卖盘数量完全由市场供需决定，不再强制补充买盘
  
  // ========== 深度平衡机制（价格回归兼容版） ==========
  // 确保买卖盘总量比例在合理范围内
  // 关键修复：当价格偏离初始价格时，扩大比例限制范围，避免抵消价格回归效果
  
  // 根据价格偏离程度动态调整深度平衡的比例限制
  // 价格偏离越大，允许的比例范围越宽，让价格回归机制有更大的作用空间
  let maxBidAskRatio = 2.0;  // 默认最大买盘/卖盘比例
  let minBidAskRatio = 0.5;  // 默认最小买盘/卖盘比例
  
  if (priceDeviationMagnitude > 0.1) {
    // 价格偏离超过10%时，扩大比例限制
    // 偏离越大，允许的比例范围越宽
    const expansionFactor = Math.min(2.0, priceDeviationMagnitude * 2);
    maxBidAskRatio = 2.0 + expansionFactor * 1.5;  // 最高可达5.0
    minBidAskRatio = 0.5 - expansionFactor * 0.2;  // 最低可达0.1
  }
  
  const bidAskRatio = totalBidGenerated / Math.max(totalAskGenerated, 0.001);
  if (bidAskRatio > maxBidAskRatio) {
    // 买盘过多，减少买盘（但不会完全抵消价格回归效果）
    const reduceFactor = maxBidAskRatio / bidAskRatio;
    bids.forEach(bid => {
      bid.quantity *= reduceFactor;
      bid.total = bid.price * bid.quantity;
    });
  } else if (bidAskRatio < minBidAskRatio) {
    // 卖盘过多，减少卖盘（但不会完全抵消价格回归效果）
    const reduceFactor = bidAskRatio / minBidAskRatio;
    asks.forEach(ask => {
      ask.quantity *= reduceFactor;
      ask.total = ask.price * ask.quantity;
    });
  }
  
  // ========== 订单量缩减 ==========
  // 观察标签代币的CEX盘口订单生成减少50%（orderScale）
  // 即将下架期间：买单生成减少50%（bidScale）、卖单生成增加100%（askScale）
  const effBidScale = orderScale * bidScale;
  const effAskScale = orderScale * askScale;
  if (effBidScale !== 1) {
    bids.forEach(bid => {
      bid.quantity *= effBidScale;
      bid.total = bid.price * bid.quantity;
    });
  }
  if (effAskScale !== 1) {
    asks.forEach(ask => {
      ask.quantity *= effAskScale;
      ask.total = ask.price * ask.quantity;
    });
  }
  
  // ========== 价格回归订单已移除 ==========
  // 根据用户要求：初始价格与现价的偏离仅影响盘口买卖盘订单生成数量，不影响订单生成价格
  // 价格回归机制仅通过 buyMultiplier 和 sellMultiplier 影响订单数量，不再在初始价格附近生成订单
  
  // ========== 插入玩家限价单（使用剩余数量，扣除已成交部分） ==========
  // 注意：玩家订单始终作为独立条目插入，不与市场订单合并
  // 这样撤单时可以精确移除玩家订单
  // 使用 playerRemainingQty 获取扣除已成交部分的剩余数量
  
  playerBuyOrders.forEach(order => {
    // 使用剩余数量（扣除已与上一回合盘口成交的部分）
    const remainingQty = playerRemainingQty[order.id] || 0;
    if (remainingQty <= 0) return;
    
    // 关键修复：使用orderId精确匹配玩家订单，而非价格匹配
    // 检查是否已存在相同订单ID的玩家订单
    const existingPlayerIndex = bids.findIndex(b => b.isPlayer && b.orderId === order.id);
    if (existingPlayerIndex >= 0) {
      // 更新已有玩家订单的数量
      bids[existingPlayerIndex].quantity += remainingQty;
      bids[existingPlayerIndex].total = bids[existingPlayerIndex].price * bids[existingPlayerIndex].quantity;
    } else {
      // 创建新的独立玩家订单条目
      bids.push({
        price: order.price,
        quantity: remainingQty,
        total: order.price * remainingQty,
        isPlayer: true,
        orderId: order.id, // 添加订单ID，用于精确匹配
      });
    }
  });
  
  playerSellOrders.forEach(order => {
    // 使用剩余数量（扣除已与上一回合盘口成交的部分）
    const remainingQty = playerRemainingQty[order.id] || 0;
    if (remainingQty <= 0) return;
    
    // 关键修复：使用orderId精确匹配玩家订单，而非价格匹配
    // 检查是否已存在相同订单ID的玩家订单
    const existingPlayerIndex = asks.findIndex(a => a.isPlayer && a.orderId === order.id);
    if (existingPlayerIndex >= 0) {
      // 更新已有玩家订单的数量
      asks[existingPlayerIndex].quantity += remainingQty;
      asks[existingPlayerIndex].total = asks[existingPlayerIndex].price * asks[existingPlayerIndex].quantity;
    } else {
      // 创建新的独立玩家订单条目
      asks.push({
        price: order.price,
        quantity: remainingQty,
        total: order.price * remainingQty,
        isPlayer: true,
        orderId: order.id, // 添加订单ID，用于精确匹配
      });
    }
  });
  

  // 排序
  bids.sort((a, b) => b.price - a.price);
  asks.sort((a, b) => a.price - b.price);
  
  // ========== 新盘口生成后的撮合 ==========
  // 【关键修复】处理所有交叉盘，包括市场订单之间的交叉
  // 当买一价 >= 卖一价时，需要进行撮合成交
  // 这确保了盘口价格的合理性，避免价格错位
  let matchIterations = 0;
  const maxMatchIterations = 100;
  
  while (bids.length > 0 && asks.length > 0 && matchIterations < maxMatchIterations) {
    const bestBid = bids[0];
    const bestAsk = asks[0];
    
    // 检查是否存在交叉盘：买一价 >= 卖一价
    if (bestBid.price >= bestAsk.price) {
      // 存在交叉，执行撮合
      const matchQty = Math.min(bestBid.quantity, bestAsk.quantity);
      
      if (matchQty > 0) {
        // 成交价格：优先使用市场订单的价格
        // 如果买单是玩家的，用卖单（市场）的价格
        // 如果卖单是玩家的，用买单（市场）的价格
        // 如果两个都是市场订单，用中间价
        let matchPrice: number;
        if (bestBid.isPlayer && !bestAsk.isPlayer) {
          matchPrice = bestAsk.price;
        } else if (!bestBid.isPlayer && bestAsk.isPlayer) {
          matchPrice = bestBid.price;
        } else {
          // 两个都是市场订单或两个都是玩家订单，使用中间价
          matchPrice = (bestBid.price + bestAsk.price) / 2;
        }
        
        // 记录玩家订单的成交详情
        if (bestBid.isPlayer) {
          // 玩家买单成交
          const orderId = bestBid.orderId || playerBuyOrders.find(o => Math.abs(o.price - bestBid.price) / Math.max(o.price, 0.0001) < 0.001)?.id;
          if (orderId) {
            if (!playerFillDetails[orderId]) {
              playerFillDetails[orderId] = { totalQty: 0, totalCost: 0 };
            }
            playerFillDetails[orderId].totalQty += matchQty;
            playerFillDetails[orderId].totalCost += matchQty * matchPrice;
          }
        }
        if (bestAsk.isPlayer) {
          // 玩家卖单成交
          const orderId = bestAsk.orderId || playerSellOrders.find(o => Math.abs(o.price - bestAsk.price) / Math.max(o.price, 0.0001) < 0.001)?.id;
          if (orderId) {
            if (!playerFillDetails[orderId]) {
              playerFillDetails[orderId] = { totalQty: 0, totalCost: 0 };
            }
            playerFillDetails[orderId].totalQty += matchQty;
            playerFillDetails[orderId].totalCost += matchQty * matchPrice;
          }
        }
        
        bestBid.quantity -= matchQty;
        bestAsk.quantity -= matchQty;
        bestBid.total = bestBid.price * bestBid.quantity;
        bestAsk.total = bestAsk.price * bestAsk.quantity;
      }
      
      // 移除数量为0的订单
      if (bestBid.quantity <= 0.001) {
        bids.shift();
      }
      if (bestAsk.quantity <= 0.001) {
        asks.shift();
      }
      
      matchIterations++;
    } else {
      // 不存在交叉盘，退出循环
      break;
    }
  }
  
  // 清理盘口中数量为0的订单
  const cleanBids = bids.filter(b => b.quantity > 0.001);
  const cleanAsks = asks.filter(a => (a.isPlayer ? a.quantity > 0.001 : a.quantity > 0));

  // 【库存守恒】CEX 卖盘物理上限的最终硬约束（只约束市场生成的卖单）：
  // 市场卖单合计 ≤ 平台可用库存；玩家限价卖单由其 cexBalance 支撑，不占用该额度。
  const marketAskQuantityTotal = cleanAsks.reduce((sum, ask) => (ask.isPlayer ? sum : sum + ask.quantity), 0);
  const remainingPhysicalAskCap = Math.max(0, availableAskLiquidityCap);
  if (marketAskQuantityTotal > remainingPhysicalAskCap) {
    if (remainingPhysicalAskCap <= 1e-9) {
      // 【模块一】库存为 0 时也保留完整 10 档极细卖单（不 splice、不留空盘口）
      cleanAsks.forEach(ask => {
        if (ask.isPlayer) return;
        ask.quantity = askLevelFloorQuantity;
        ask.total = ask.price * ask.quantity;
      });
    } else {
      const askScaleByPhysicalCap = remainingPhysicalAskCap / marketAskQuantityTotal;
      cleanAsks.forEach(ask => {
        if (ask.isPlayer) return;
        ask.quantity = Math.max(askLevelFloorQuantity, ask.quantity * askScaleByPhysicalCap);
        ask.total = ask.price * ask.quantity;
      });
    }
  }
  
  // ========== 计算玩家订单在盘口撮合中的成交详情 ==========
  const playerOrderFills: Record<string, { quantity: number; avgPrice: number }> = {};
  
  Object.entries(playerFillDetails).forEach(([orderId, details]) => {
    if (details.totalQty > 0) {
      playerOrderFills[orderId] = {
        quantity: details.totalQty,
        avgPrice: details.totalCost / details.totalQty,
      };
    }
  });
  
  // ========== 计算当前价格 ==========
  // 【关键修复】当前价格 = 市场买一价（最高买入价，跳过玩家挂单）
  // 玩家挂单只是意向报价，未成交前不应推动市场价格
  // 这样K线收盘价与市场盘口买一价一致
  const marketBids = cleanBids.filter(b => !b.isPlayer);
  const marketAsks = cleanAsks.filter(a => !a.isPlayer);
  const bestBid = marketBids[0]?.price || newCandle.close * 0.99;
  const bestAsk = marketAsks[0]?.price || newCandle.close * 1.01;
  
  // 获取上一回合价格作为基准
  const prevRoundPrice = prevOrderBook?.lastPrice || newCandle.open;
  const safePrevRoundPrice = prevRoundPrice > 0.0001 ? prevRoundPrice : 0.0001;
  
  // 当前价格 = 市场买一价（最高买入价）
  // 【关键修复】确保lastPrice始终反映市场买一价，跳过玩家挂单（玩家挂单不应推动价格）
  let lastPrice = bestBid;
  if (marketBids.length === 0 && marketAsks.length > 0) {
    // 市场买盘空时取卖一价 * [0.98, 0.998] 随机值
    const randomFactor = 0.98 + Math.random() * 0.018; // 0.98 + [0, 0.018] = [0.98, 0.998]
    lastPrice = bestAsk * randomFactor;
  } else if (marketAsks.length === 0 && marketBids.length > 0) {
    // 市场卖盘空但有买盘时，lastPrice直接使用市场买一价
    lastPrice = bestBid;
  }
  
  // 价格下限为0
  lastPrice = Math.max(0.0000001, lastPrice);
  
  const totalBidQuantity = cleanBids.reduce((sum, b) => sum + b.quantity, 0);
  const totalAskQuantity = cleanAsks.reduce((sum, a) => sum + a.quantity, 0);
  
  // 高低价独立于盘口价格，仅使用K线计算的高低价
  // 不与现货盘口价格、DEX价格、合约价格关联
  const highPrice = newCandle.high;
  const lowPrice = newCandle.low;
  
  return {
    tokenId: token.id, // 添加tokenId用于AI交易识别
    bids: cleanBids.slice(0, 10),
    asks: cleanAsks.slice(0, 10),
    lastPrice,
    highPrice,
    lowPrice,
    volatilityMultiplier: prevOrderBook?.volatilityMultiplier || 1,
    totalBidQuantity,
    totalAskQuantity,
    playerOrderFills, // 玩家订单在盘口撮合中的成交量
  };
}
