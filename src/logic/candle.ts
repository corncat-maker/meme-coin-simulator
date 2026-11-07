// 从 src/App.tsx 机械搬迁（Stage 1），逻辑未改动。
import type { Candle, Level2OrderBook, Order, OrderBookEntry, Token } from '../types';
import { computeRoundVolume } from './volume';
import { getMechanicsTier, getTierHighLowFloatRange, getTierVolatilityRange } from '../data/tokenMeta';

/**
 * 计算K线价格 - 简化版
 * 
 * 计算规则：
 * 1. 开盘价 = 上回合收盘价
 * 2. 收盘价 = 50%参考CEX盘口买一价(若无则为卖一价) + 50%参考DEX价格(AMM中间价)
 * 3. 最高价/最低价按当回合涨跌方向区分参考价（详见函数内注释）：
 *    - 当回合为涨：最高价根据收盘价向上浮动，最低价根据开盘价向下浮动
 *    - 当回合为跌：最高价根据开盘价向上浮动，最低价根据收盘价向下浮动
 *    - 浮动幅度根据代币tier确定
 */
export function calculateNextCandle(
  prevCandle: Candle,
  orderBook: Level2OrderBook,
  token: Token,
  playerLimitOrders: Order[] = [],
  heat: number = 0,
  liquidationInfo?: { // 强平金额信息（用于K线高低价浮动计算）
    shortLiquidationAmount: number; // 空头强平金额（推高最高价）
    longLiquidationAmount: number; // 多头强平金额（推低最低价）
  },
  eventPriceMultiplier: number = 1, // 市场事件价格乘数（影响K线收盘价）
  forcePriceLinkage: boolean = false, // 强制价格联动：做市商正在做市该代币或CEX/DEX价差超过10%时，即使无玩家挂单也按盘口价格模式计算
  activeEventLevelEffect?: { type: 'bull' | 'bear'; level: number } | null // 三级以上事件公布当回合的事件信息（用于K线高低价浮动）
): Candle {
  // 1. 开盘价 = 上回合收盘价
  const open = prevCandle.close;
  
  // ========== 判断CEX盘口是否存在玩家挂单 ==========
  // 筛选有效的玩家限价单（状态为pending）
  const playerBuyOrders = playerLimitOrders.filter(o => o.side === 'buy' && o.status === 'pending');
  const playerSellOrders = playerLimitOrders.filter(o => o.side === 'sell' && o.status === 'pending');
  const hasPlayerOrders = playerBuyOrders.length > 0 || playerSellOrders.length > 0;
  
  // 2. 收盘价计算（根据是否存在玩家挂单区分）
  // 【关键修改】当CEX盘口不存在玩家挂单时，收盘价改为纯随机波动
  let close: number;
  
  if (!hasPlayerOrders && !forcePriceLinkage) {
    // ========== 无玩家挂单且无做市商做市且价差未超限：纯随机波动模式 ==========
    // 收盘价完全由随机波动决定，不受CEX买一价、DEX价格、合约价格影响
    const prevBasePrice = prevCandle.close || token.initialPrice;
    const safePrevBasePrice = prevBasePrice > 0.0001 ? prevBasePrice : 0.0001;
    
    // 根据tier确定波动率范围（含随机波动加成：异常大波动后波动率提升n%/10并逐回合衰减）
    // tier 1(微型): 2%-5%, tier 2(小型): 1%-3%, tier 3(中型): 0.5%-2%
    // tier 4(大型): 0.3%-1%, tier 5(巨型): 0.2%-0.5%, tier 6(巨鲸): 0.1%-0.2%
    const { volMin: baseMinFloat, volMax: baseMaxFloat } = getTierVolatilityRange(getMechanicsTier(token));
    const candleVolBoost = token.volBoostPct || 0;
    const effMinFloat = baseMinFloat + candleVolBoost;
    const effMaxFloat = baseMaxFloat + candleVolBoost;
    const volatility = effMinFloat + Math.random() * (effMaxFloat - effMinFloat);
    // 使用独立的随机数生成方向，确保真正的50/50概率
    const direction = Math.random() > 0.5 ? 1 : -1;
    const change = direction * volatility;
    // 纯随机波动，不受CEX买一价、DEX价格、合约价格影响
    close = safePrevBasePrice * (1 + change);
  } else {
    // ========== 价格联动模式（有玩家挂单/做市商正在做市/CEX-DEX价差超过10%） ==========
    // 收盘价 = 50%参考CEX订单簿买一价(若无则参考卖一价，若卖一价也无则参考盘口生成基准价格)
    //         + 50%参考DEX价格（AMM流动性池中间价 quoteReserve / tokenReserve）
    // 不参考合约市场；DEX流动性池不存在时退回纯CEX价格
    // 【修复】玩家限价单合并进盘口后再取买一/卖一价，解决"玩家挂单成为买一/卖一时
    // K线收盘价延迟一个回合才检测到"的问题。
    // 合并规则与 generateNextPeriodOrderBook 保持一致：
    // 1. 玩家挂单先与旧盘口市场订单撮合（成交部分不再挂单）
    // 2. 剩余数量插入盘口（已在盘口中的订单不重复插入）
    // 3. 撮合交叉盘（买一 >= 卖一）
    // 4. 收盘价 = 合并后买一价 > 卖一价 > 盘口基准价格
    const mergedBids: OrderBookEntry[] = orderBook.bids.map(b => ({ ...b }));
    const mergedAsks: OrderBookEntry[] = orderBook.asks.map(a => ({ ...a }));
    // 已存在于盘口中的玩家订单ID（避免重复插入）
    const existingPlayerOrderIds = new Set<string>();
    mergedBids.concat(mergedAsks).forEach(e => {
      if (e.isPlayer && e.orderId) existingPlayerOrderIds.add(e.orderId);
    });
    // 撮合用盘口：仅市场订单（与盘口生成逻辑一致，玩家挂单不与旧盘口玩家挂单成交）
    const matchBids = mergedBids.filter(b => !b.isPlayer).map(b => ({ ...b }));
    const matchAsks = mergedAsks.filter(a => !a.isPlayer).map(a => ({ ...a }));

    // 玩家买单与旧卖盘撮合（以卖盘价格成交），记录剩余数量
    const remainingBuyQty: Record<string, number> = {};
    playerBuyOrders.forEach(order => {
      let remaining = order.quantity - (order.filledQuantity || 0);
      if (remaining <= 0) return;
      for (let i = 0; i < matchAsks.length && remaining > 0; i++) {
        const ask = matchAsks[i];
        if (ask.price <= order.price) {
          const fillQty = Math.min(remaining, ask.quantity);
          if (fillQty > 0) {
            remaining -= fillQty;
            ask.quantity -= fillQty;
          }
        }
      }
      if (remaining > 0) remainingBuyQty[order.id] = remaining;
    });
    // 玩家卖单与旧买盘撮合（以买盘价格成交），记录剩余数量
    const remainingSellQty: Record<string, number> = {};
    playerSellOrders.forEach(order => {
      let remaining = order.quantity - (order.filledQuantity || 0);
      if (remaining <= 0) return;
      for (let i = 0; i < matchBids.length && remaining > 0; i++) {
        const bid = matchBids[i];
        if (bid.price >= order.price) {
          const fillQty = Math.min(remaining, bid.quantity);
          if (fillQty > 0) {
            remaining -= fillQty;
            bid.quantity -= fillQty;
          }
        }
      }
      if (remaining > 0) remainingSellQty[order.id] = remaining;
    });

    // 将剩余玩家挂单插入盘口
    playerBuyOrders.forEach(order => {
      if (existingPlayerOrderIds.has(order.id)) return;
      const remain = remainingBuyQty[order.id] || 0;
      if (remain <= 0) return;
      mergedBids.push({ price: order.price, quantity: remain, total: order.price * remain, isPlayer: true, orderId: order.id });
    });
    playerSellOrders.forEach(order => {
      if (existingPlayerOrderIds.has(order.id)) return;
      const remain = remainingSellQty[order.id] || 0;
      if (remain <= 0) return;
      mergedAsks.push({ price: order.price, quantity: remain, total: order.price * remain, isPlayer: true, orderId: order.id });
    });

    // 排序：买盘降序、卖盘升序
    mergedBids.sort((a, b) => b.price - a.price);
    mergedAsks.sort((a, b) => a.price - b.price);

    // 撮合交叉盘（买一 >= 卖一）：与盘口生成逻辑保持一致
    let matchIter = 0;
    while (mergedBids.length > 0 && mergedAsks.length > 0 && matchIter < 100) {
      const bestBid = mergedBids[0];
      const bestAsk = mergedAsks[0];
      if (bestBid.price < bestAsk.price) break;
      const matchQty = Math.min(bestBid.quantity, bestAsk.quantity);
      bestBid.quantity -= matchQty;
      bestAsk.quantity -= matchQty;
      if (bestBid.quantity <= 0.001) mergedBids.shift();
      if (bestAsk.quantity <= 0.001) mergedAsks.shift();
      matchIter++;
    }

    // 收盘价优先级：买一价 > 卖一价 > 盘口基准价格（CEX价格）
    // 【修改】K线收盘价仅参考 CEX 价格与随机波动机制，不再参考 DEX 价格
    const cexBidPrice = mergedBids[0]?.price;
    const cexAskPrice = mergedAsks[0]?.price;
    const cexBasePrice = orderBook.lastPrice || open;
    close = cexBidPrice || cexAskPrice || cexBasePrice;
  }
  
  // 【市场事件】事件价格乘数作用于K线收盘价
  // 利多事件上涨、利空事件下跌（乘数大于1为上涨，小于1为下跌）
  close = close * eventPriceMultiplier;
  close = Math.max(0.00001, close);
  
  // 3. 最高价 / 最低价计算（按当回合涨跌方向区分参考价）
  // 【重要规则】
  // 当回合K线为涨（收盘价 >= 开盘价）时：
  //   最高价根据收盘价向上浮动，最低价根据开盘价向下浮动
  // 当回合K线为跌（收盘价 < 开盘价）时：
  //   最高价根据开盘价向上浮动，最低价根据收盘价向下浮动
  // 浮动幅度根据代币tier确定（tier越高浮动越小）
  const safeClose = Math.max(0.00001, close);
  
  // ========== K线最高价最低价浮动机制（基于tier，与热度无关） ==========
  // 浮动幅度范围与初始化K线共用同一套参数（getTierHighLowFloatRange）：
  // tier 1（微型）：1%-3%
  // tier 2（小型）：0.5%-2%
  // tier 3（中型）：0.2%-1%
  // tier 4（大型）：0.1%-0.5%
  // tier 5（巨型）：0.05%-0.3%
  // tier 6（巨鲸）：0.01%-0.15%
  const tier = getMechanicsTier(token);
  const { floatMin, floatMax } = getTierHighLowFloatRange(tier);
  // 【随机波动加成】最高价最低价的波动同步提升 n%/20（n为异常波动幅度，即波动加成的一半）
  const highLowBoost = (token.volBoostPct || 0) / 2;
  const effFloatMin = floatMin + highLowBoost;
  const effFloatMax = floatMax + highLowBoost;
  
  // tier基准随机浮动率
  const tierFloatRate = effFloatMin + Math.random() * (effFloatMax - effFloatMin);
  
  let high: number;
  let low: number;
  
  if (safeClose >= open) {
    // 当回合K线为涨：最高价根据收盘价向上浮动（tier浮动），最低价根据开盘价向下浮动（tier浮动）
    high = safeClose * (1 + tierFloatRate);
    low = open * (1 - tierFloatRate);
  } else {
    // 当回合K线为跌：最高价根据开盘价向上浮动（tier浮动），最低价根据收盘价向下浮动（tier浮动）
    high = open * (1 + tierFloatRate);
    low = safeClose * (1 - tierFloatRate);
  }
  
  // 确保最高价 >= 收盘价 >= 最低价
  high = Math.max(high, open, safeClose);
  low = Math.min(low, open, safeClose);
  
  // 防止价格为0或负数
  high = Math.max(0.00001, high);
  low = Math.max(0.00001, low);
  
  // ========== 事件驱动K线高低价浮动机制（三级以上事件公布当回合） ==========
  // 规则：
  // 1. 出现三级以上（1-3级）利多事件时（即使当回合是上涨的事件），
  //    当回合最高价在收盘价基础上向上浮动，浮动量 = 当回合上涨幅度 × 50%
  // 2. 出现三级以上（1-3级）利空事件时（即使当回合是下跌的事件），
  //    当回合最低价在收盘价基础上向下浮动，浮动量 = 当回合下跌幅度 × 50%
  // 仅事件公布当回合生效（与事件价格乘数生效范围一致）
  if (activeEventLevelEffect && activeEventLevelEffect.level <= 3) {
    const eventChange = (safeClose - open) / open; // 当回合涨跌幅（相对开盘价，正为上涨负为下跌）
    if (activeEventLevelEffect.type === 'bull' && eventChange > 0) {
      // 利多事件：最高价在收盘价基础上向上浮动当回合涨幅的50%
      high = Math.max(high, safeClose * (1 + eventChange * 0.5));
    } else if (activeEventLevelEffect.type === 'bear' && eventChange < 0) {
      // 利空事件：最低价在收盘价基础上向下浮动当回合跌幅的50%
      low = Math.min(low, safeClose * (1 + eventChange * 0.5));
    }
  }
  
  // ========== 强平金额推高/压低K线高低价 ==========
  // 规则：
  // 1. 空头强平金额推高最高价：空头被强平时需买入代币平仓，形成买压，最高价在收盘价基础上向上延伸
  // 2. 多头强平金额推低最低价：多头被强平时需卖出代币平仓，形成卖压，最低价在收盘价基础上向下延伸
  // 浮动量 = 强平金额 / (市值 × 20)，空头最多推高25%，多头最多压低20%（与回合推进强平叠加规则一致）
  if (liquidationInfo && (liquidationInfo.shortLiquidationAmount > 0 || liquidationInfo.longLiquidationAmount > 0)) {
    const liqMarketCap = token.circulatingSupply * safeClose;
    if (liqMarketCap > 0) {
      if (liquidationInfo.shortLiquidationAmount > 0) {
        const shortBoost = Math.min(liquidationInfo.shortLiquidationAmount / (liqMarketCap * 20), 0.25);
        if (shortBoost > 0) {
          high = Math.max(high, safeClose * (1 + shortBoost));
        }
      }
      if (liquidationInfo.longLiquidationAmount > 0) {
        const longDrop = Math.min(liquidationInfo.longLiquidationAmount / (liqMarketCap * 20), 0.2);
        if (longDrop > 0) {
          low = Math.min(low, safeClose * (1 - longDrop));
        }
      }
    }
  }
  
  // 再次确保最高价 >= 收盘价 >= 最低价
  high = Math.max(high, safeClose, open);
  low = Math.min(low, safeClose, open);
  
  // ========== 成交量 / 成交额（纯公式合成，1 回合 = 1 游戏小时） ==========
  // 单回合成交量 = 基础代币成交量（自然换手）+ 热度代币成交量（绝对资金增量）
  //   基础量 = 流通量 × 基础每小时换手率(tier) × (1 + |当回合涨跌幅| × 10)
  //   热度量 = (热度 / 100) × 30,000,000 / VWAP，且不超过流通量 × 3
  // 当回合成交额 = 单回合成交量 × VWAP
  const vwap = (high + low + safeClose) / 3;
  const roundChange = open > 0 ? (safeClose - open) / open : 0;
  const roundVolume = computeRoundVolume({
    tier,
    circulatingSupply: token.circulatingSupply || token.totalSupply || 0,
    roundChange,
    heat,
    vwap,
  });

  return {
    time: Date.now(),
    open,
    high,
    low,
    close: safeClose,
    volume: roundVolume.volume,
    vwap: roundVolume.vwap,
    turnover: roundVolume.turnover,
  };
}
