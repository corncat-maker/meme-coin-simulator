/**
 * 回合推进（handleFastForward）纯函数化 —— 切片 B2：上下文与状态契约
 *
 * 本文件在 B2 阶段只定义「数据契约 + 空壳实现」，不承载任何业务计算：
 *   - FastForwardContext：一回合推进所需的**全部**输入（严禁在纯函数内读取 React state）
 *   - NextRoundState：一回合推进产出的**全新**状态集合（不可变，绝不原地改 ctx 内对象）
 *   - computeNextRound：B3 会把真实计算逐段搬进来；当前为透传空壳，保证主流程可跑通
 *
 * 红线：
 *   1. 本文件不得 import React / store / 任何带副作用模块。
 *   2. 随机数只能来自 ctx.rng（回合级种子生成器），禁止 Math.random。
 *   3. 不得修改 ctx 内的任何对象（B3 落地时由回归快照 0 差异把关）。
 */
import { computeAvailableAskLiquidity } from './inventory';
import { calculateNextCandle } from './candle';
import { rnd } from './rng';
import { generateNextPeriodOrderBook } from './orderbook';
import {
  calculateCrossLiquidationPrice,
  calculateFundingRate,
  calculateFuturesPnl,
  calculateLiquidationPrice,
  checkRetailLiquidation,
  generateFuturesOrderBook,
  getFundingConfig,
} from './futures';
import { getMechanicsTier, getTierHighLowFloatRange, getTierVolatilityRange, getTokenTier } from '../data/tokenMeta';
import { isDelistPending } from './delist';
import type {
  Candle,
  Token,
  Position,
  Order,
  OrderHistory,
  PlayerTokenBalance,
  PendingTransfer,
  WalletLpPosition,
  CexReserveHistoryPoint,
  LoanPosition,
  Level2OrderBook,
  LiquidityPool,
  Announcement,
  RetailPosition,
  FuturesPosition,
  FuturesOrder,
  FuturesTradeRecord,
  FuturesOrderBook,
  AITrader,
  AIMarketMaker,
} from '../types';

/** 一回合推进的完整输入上下文（全部为只读快照）。 */
export interface FastForwardContext {
  /** 当前回合（推进前） */
  currentRound: number;
  /** 回合级随机源：同一 seed + 同一回合 → 序列完全一致 */
  rng: () => number;

  // ---- 市场物理层 ----
  tokens: Token[];
  liquidityPools: Record<string, LiquidityPool>;
  tokenOrderBookMap: Record<string, Level2OrderBook>;
  tokenCandlesMap: Record<string, Candle[]>;
  cexReserveHistory: Record<string, CexReserveHistoryPoint[]>;

  // ---- 参与者 ----
  aiTraders: AITrader[];
  aiMarketMakers: AIMarketMaker[];

  // ---- 玩家资产（CEX 侧） ----
  positions: Position[];
  orders: Order[];
  orderHistory: OrderHistory[];
  availableCapital: number;
  frozenCapital: number;
  playerTokenBalances: Record<string, PlayerTokenBalance>;

  // ---- 玩家资产（Web3 侧） ----
  walletUsdt: number;
  walletLpPositions: Record<string, WalletLpPosition>;
  pendingTransfers: PendingTransfer[];
  loanPositions: LoanPosition[];

  // ---- 合约市场 ----
  futuresPositions: FuturesPosition[];
  futuresOrders: FuturesOrder[];
  retailPositions: RetailPosition[];
  futuresOrderBookMap: Record<string, FuturesOrderBook>;
  futuresTradeHistory: FuturesTradeRecord[];

  // ---- 事件/公告 ----
  announcements: Announcement[];
}

/**
 * 一回合推进产出的全新状态集合。
 * 约定：每个字段都是**新对象/新数组**，不得复用 ctx 内被修改过的引用。
 */
export interface NextRoundState {
  currentRound: number;

  tokens: Token[];
  liquidityPools: Record<string, LiquidityPool>;
  tokenOrderBookMap: Record<string, Level2OrderBook>;
  tokenCandlesMap: Record<string, Candle[]>;
  cexReserveHistory: Record<string, CexReserveHistoryPoint[]>;

  aiTraders: AITrader[];
  aiMarketMakers: AIMarketMaker[];

  positions: Position[];
  orders: Order[];
  orderHistory: OrderHistory[];
  availableCapital: number;
  frozenCapital: number;
  playerTokenBalances: Record<string, PlayerTokenBalance>;

  walletUsdt: number;
  walletLpPositions: Record<string, WalletLpPosition>;
  pendingTransfers: PendingTransfer[];
  loanPositions: LoanPosition[];

  futuresPositions: FuturesPosition[];
  futuresOrders: FuturesOrder[];
  retailPositions: RetailPosition[];
  futuresOrderBookMap: Record<string, FuturesOrderBook>;
  futuresTradeHistory: FuturesTradeRecord[];

  announcements: Announcement[];
}

/**
 * B2 空壳：不做任何计算，把 Context 原样映射为 NextRoundState（浅引用，只读透传）。
 * B3 起将逐个领域把真实计算搬入（盘口/成交/库存/AI），并保证结果与旧实现逐位一致。
 */
export function computeNextRound(ctx: FastForwardContext): NextRoundState {
  return {
    currentRound: ctx.currentRound + 1,
    tokens: ctx.tokens,
    liquidityPools: ctx.liquidityPools,
    tokenOrderBookMap: ctx.tokenOrderBookMap,
    tokenCandlesMap: ctx.tokenCandlesMap,
    cexReserveHistory: ctx.cexReserveHistory,
    aiTraders: ctx.aiTraders,
    aiMarketMakers: ctx.aiMarketMakers,
    positions: ctx.positions,
    orders: ctx.orders,
    orderHistory: ctx.orderHistory,
    availableCapital: ctx.availableCapital,
    frozenCapital: ctx.frozenCapital,
    playerTokenBalances: ctx.playerTokenBalances,
    walletUsdt: ctx.walletUsdt,
    walletLpPositions: ctx.walletLpPositions,
    pendingTransfers: ctx.pendingTransfers,
    loanPositions: ctx.loanPositions,
    futuresPositions: ctx.futuresPositions,
    futuresOrders: ctx.futuresOrders,
    retailPositions: ctx.retailPositions,
    futuresOrderBookMap: ctx.futuresOrderBookMap,
    futuresTradeHistory: ctx.futuresTradeHistory,
    announcements: ctx.announcements,
  };
}

/** 诊断用：返回 Context 中缺失/未定义的字段名（开发断言使用）。 */
export function findMissingContextFields(ctx: Partial<FastForwardContext>): string[] {
  const required: Array<keyof FastForwardContext> = [
    'currentRound', 'rng', 'tokens', 'liquidityPools', 'tokenOrderBookMap', 'tokenCandlesMap',
    'cexReserveHistory', 'aiTraders', 'aiMarketMakers', 'positions', 'orders', 'orderHistory',
    'availableCapital', 'frozenCapital', 'playerTokenBalances', 'walletUsdt', 'walletLpPositions',
    'pendingTransfers', 'loanPositions', 'futuresPositions', 'futuresOrders', 'retailPositions',
    'futuresOrderBookMap', 'futuresTradeHistory', 'announcements',
  ];
  return required.filter((key) => ctx[key] === undefined || ctx[key] === null);
}

/**
 * 【Stage3-B3 · 域一】盘口生成参数（有效市值 / 持仓占比 / 库存水位）纯函数。
 * 逐字搬运自 handleFastForward 内部计算，未改动任何公式与顺序。
 */
export interface OrderBookParamsInput {
  token: Token;
  playerHoldings: number;
  aiHoldingQuantity: number;
  marketMakerHoldingQuantity: number;
  playerCexBalance: number;
  currentRound: number;
  delistPendingTokenIdsThisRound: Set<string>;
  delistResidualAvgEntry: number | undefined;
}

export interface OrderBookParamsResult {
  aiHoldingRatio: number;
  playerHoldingRatio: number;
  playerReservedRatio: number;
  playerMarketHoldingRatio: number;
  combinedHoldingRatio: number;
  marketMakerHoldingRatio: number;
  availableAskLiquidity: number;
  isDelistPendingToken: boolean;
  tokenForOrderBook: Token;
}

export function computeOrderBookParams(input: OrderBookParamsInput): OrderBookParamsResult {
  const {
    token, playerHoldings, aiHoldingQuantity, marketMakerHoldingQuantity,
    playerCexBalance, currentRound, delistPendingTokenIdsThisRound, delistResidualAvgEntry,
  } = input;

  const aiHoldingRatio = token.circulatingSupply > 0 ? aiHoldingQuantity / token.circulatingSupply : 0;
  const playerHoldingRatio = token.circulatingSupply > 0 ? playerHoldings / token.circulatingSupply : 0;
  const playerReservedRatio = token.isPlayerCreated && token.playerReservedAmount && token.circulatingSupply
    ? token.playerReservedAmount / token.circulatingSupply
    : 0;
  const playerMarketHoldingRatio = Math.max(0, playerHoldingRatio - playerReservedRatio);
  const combinedHoldingRatio = Math.min(1, playerMarketHoldingRatio + aiHoldingRatio);
  const marketMakerHoldingRatio = token.circulatingSupply > 0 ? marketMakerHoldingQuantity / token.circulatingSupply : 0;
  const availableAskLiquidity = computeAvailableAskLiquidity(
    token.cexReserve || 0,
    playerCexBalance,
    aiHoldingQuantity,
    marketMakerHoldingQuantity,
  );
  const isDelistPendingToken = delistPendingTokenIdsThisRound.has(token.id) || isDelistPending(token, currentRound);
  const tokenForOrderBook: Token = delistResidualAvgEntry && delistResidualAvgEntry > 0
    ? { ...token, delistSpotBasePrice: delistResidualAvgEntry }
    : token;

  return {
    aiHoldingRatio, playerHoldingRatio, playerReservedRatio, playerMarketHoldingRatio,
    combinedHoldingRatio, marketMakerHoldingRatio,
    availableAskLiquidity, isDelistPendingToken, tokenForOrderBook,
  };
}

/**
 * 【Stage3-B3 · 域一】本回合涨跌幅与连续涨跌（趋势）状态纯函数。
 * 逐字搬运自 handleFastForward 内部，公式与分支顺序完全一致。
 */
export interface TrendStateInput {
  prevRoundPrice: number;
  newCandleClose: number;
  prevDirection: 'up' | 'down' | 'flat';
  prevTrendStartPrice: number;
}

export interface TrendStateResult {
  currentRoundChange: number;
  currentDirection: 'up' | 'down' | 'flat';
  cumulativeChange: number;
  newTrendStartPrice: number;
  newTrendDirection: 'up' | 'down' | 'flat';
}

export function computeTrendState(input: TrendStateInput): TrendStateResult {
  const { newCandleClose, prevDirection, prevTrendStartPrice } = input;
  const prevRoundPrice = input.prevRoundPrice;
  const safePrevRoundPrice = prevRoundPrice > 0.0001 ? prevRoundPrice : 0.0001;
  const estimatedNewPrice = newCandleClose;
  const currentRoundChange = (estimatedNewPrice - safePrevRoundPrice) / safePrevRoundPrice;

  const CHANGE_THRESHOLD = 0.001;
  const currentDirection: 'up' | 'down' | 'flat' =
    currentRoundChange > CHANGE_THRESHOLD ? 'up' :
    currentRoundChange < -CHANGE_THRESHOLD ? 'down' : 'flat';

  let cumulativeChange = currentRoundChange;
  let newTrendStartPrice = safePrevRoundPrice;
  let newTrendDirection = currentDirection;

  if (currentDirection === 'flat') {
    cumulativeChange = currentRoundChange;
    newTrendStartPrice = safePrevRoundPrice;
    newTrendDirection = 'flat';
  } else if (currentDirection === prevDirection) {
    const safeTrendStartPrice = prevTrendStartPrice > 0.0001 ? prevTrendStartPrice : 0.0001;
    cumulativeChange = (estimatedNewPrice - safeTrendStartPrice) / safeTrendStartPrice;
    newTrendStartPrice = prevTrendStartPrice;
    newTrendDirection = currentDirection;
  } else {
    cumulativeChange = currentRoundChange;
    newTrendStartPrice = safePrevRoundPrice;
    newTrendDirection = currentDirection;
  }

  return { currentRoundChange, currentDirection, cumulativeChange, newTrendStartPrice, newTrendDirection };
}

/** 单枚代币在本回合的 K 线输入（全部为标量/只读引用，无副作用） */
export interface TokenCandleInput {
  lastCandle: Candle;
  tokenOrderBook: Level2OrderBook;
  token: Token;
  playerLimitOrders: Order[];
  tokenHeat: number;
  aiLiquidationInfo: Parameters<typeof calculateNextCandle>[5];
  eventMultiplier: number;
  forcePriceLinkage: boolean;
  eventLevelEffect: Parameters<typeof calculateNextCandle>[8];
  oldFuturesBook: FuturesOrderBook | undefined;
}

export interface TokenCandleResult {
  newCandle: Candle;
  fundingRate: number;
  trend: TrendStateResult;
}

/**
 * 【域一收口 · K线编排层】
 * 逐字搬运 calculateNextCandle 调用 + 资金费率读取 + 涨跌趋势计算。
 */
export function computeCandleForToken(input: TokenCandleInput): TokenCandleResult {
  const {
    lastCandle, tokenOrderBook, token, playerLimitOrders, tokenHeat,
    aiLiquidationInfo, eventMultiplier, forcePriceLinkage, eventLevelEffect, oldFuturesBook,
  } = input;

  const newCandle = calculateNextCandle(
    lastCandle,
    tokenOrderBook,
    token,
    playerLimitOrders,
    tokenHeat,
    aiLiquidationInfo,
    eventMultiplier,
    forcePriceLinkage,
    eventLevelEffect,
  );

  const fundingRate = oldFuturesBook ? oldFuturesBook.fundingRate : 0;

  const prevRoundPrice = tokenOrderBook.lastPrice || token.currentPrice;
  const trend = computeTrendState({
    prevRoundPrice,
    newCandleClose: newCandle.close,
    prevDirection: (token.trendDirection || 'flat') as 'up' | 'down' | 'flat',
    prevTrendStartPrice: token.trendStartPrice || (prevRoundPrice > 0.0001 ? prevRoundPrice : 0.0001),
  });

  return { newCandle, fundingRate, trend };
}

/** 【域一收口 · 盘口生成调用层】入参全部为标量/只读引用 */
export interface TokenOrderBookInput {
  token: Token;
  prevBook: Level2OrderBook;
  newCandle: Candle;
  playerLimitOrders: Order[];
  playerHoldings: number;
  tokenHeat: number;
  round: number;
  fundingRate: number;
  marketingEffect: Token['marketingEffect'];
  cumulativeChange: number;
  isHotSectorToken: boolean;
  aiHoldingRatio: number;
  playerReservedRatio: number;
  marketMakerHoldingRatio: number;
  eventMultiplier: number;
  eventUpProbability: number | null;
  forcePriceLinkage: boolean;
  orderScale: number;
  bidScale: number;
  askScale: number;
  availableAskLiquidity: number;
}

/** 逐字搬运 generateNextPeriodOrderBook 的 25 个实参位置，不改任何取值逻辑 */
export function computeOrderBookForToken(input: TokenOrderBookInput): Level2OrderBook {
  return generateNextPeriodOrderBook(
    input.token,
    input.prevBook,
    input.newCandle,
    input.playerLimitOrders,
    input.playerHoldings,
    input.tokenHeat,
    input.round,
    input.fundingRate,
    input.marketingEffect,
    input.cumulativeChange,
    input.isHotSectorToken,
    input.aiHoldingRatio,
    input.playerReservedRatio,
    input.marketMakerHoldingRatio,
    input.eventMultiplier,
    input.eventUpProbability,
    input.forcePriceLinkage,
    input.orderScale,
    input.bidScale,
    input.askScale,
    input.availableAskLiquidity,
  );
}

/** 【域一收口-2 · 双轨价格与K线组装】入参只读，返回全新对象 */
export interface SpotAssemblyInput {
  token: Token;
  book: Level2OrderBook;
  playerLimitOrders: Order[];
  forcePriceLinkage: boolean;
  eventUpProbability: number | null;
  eventMultiplier: number;
  newCandle: Candle;
  prevCandles: Candle[];
  aiLiquidationInfo: { shortLiquidationAmount: number; longLiquidationAmount: number } | null;
  liquidityPools: Record<string, LiquidityPool>;
  newLiquidityPoolUpdates: Record<string, LiquidityPool>;
  futuresOrderBookMap: Record<string, FuturesOrderBook>;
}
export interface SpotAssemblyResult {
  newBook: Level2OrderBook;
  finalPrice: number;
  orderBookPrice: number;
  newPool: LiquidityPool | null;
  updatedCandle: Candle;
  newCandles: Candle[];
}
export function computeSpotRoundResult(input: SpotAssemblyInput): SpotAssemblyResult {
        // 合约价格独立生成，通过资金费率与现货价格联动
        let newBook: Level2OrderBook;
        let newPool: LiquidityPool | null = input.newLiquidityPoolUpdates[input.token.id] || input.liquidityPools[input.token.id] || null;
        let finalPrice: number;
      
        // ========== 判断CEX盘口是否存在玩家挂单 ==========
        // 【关键修改】当CEX盘口不存在玩家挂单时，最终价格改为纯随机波动
        // 【性能优化】单次遍历判断，避免为每个代币创建两个过滤数组
        let hasPlayerOrders = false;
        for (let pi = 0; pi < input.playerLimitOrders.length; pi++) {
          const po = input.playerLimitOrders[pi];
          if (po.status === 'pending' && (po.side === 'buy' || po.side === 'sell')) {
            hasPlayerOrders = true;
            break;
          }
        }
      
        // CEX盘口价格
        const cexPrice = input.book.lastPrice || input.book.bids[0]?.price || input.token.currentPrice;
      
        // 合约市场价格（从合约订单簿获取买一价）
        const futuresBook = input.futuresOrderBookMap[input.token.id];
        const futuresPrice = futuresBook?.bids[0]?.price || cexPrice; // 如果没有合约盘口，使用CEX价格
      
        if (!hasPlayerOrders && !input.forcePriceLinkage) {
          // ========== 无玩家挂单且无做市商做市且价差未超限：CEX 纯随机波动模式 ==========
          // CEX 最终价格完全由随机波动决定，不受 DEX 价格影响
          const prevBasePrice = input.token.currentPrice || input.token.initialPrice;
          const safePrevBasePrice = prevBasePrice > 0.0001 ? prevBasePrice : 0.0001;
        
          // 根据tier确定波动率范围（含随机波动加成）
          // tier 1(微型): 2%-5%, tier 2(小型): 1%-3%, tier 3(中型): 0.5%-2%
          // tier 4(大型): 0.3%-1%, tier 5(巨型): 0.2%-0.5%, tier 6(巨鲸): 0.1%-0.2%
          const { volMin: finalBaseMin, volMax: finalBaseMax } = getTierVolatilityRange(getMechanicsTier(input.token));
          const finalVolBoost = input.token.volBoostPct || 0;
          const effFinalMin = finalBaseMin + finalVolBoost;
          const effFinalMax = finalBaseMax + finalVolBoost;
          const volatility = effFinalMin + rnd() * (effFinalMax - effFinalMin);
          // 使用独立的随机数生成方向；事件窗口内按事件上涨概率偏向（默认50/50）
          const direction = input.eventUpProbability != null ? (rnd() < input.eventUpProbability ? 1 : -1) : (rnd() > 0.5 ? 1 : -1);
          const change = direction * volatility;
          // 【市场事件】事件影响乘数叠加到最终价格
          finalPrice = safePrevBasePrice * (1 + change) * input.eventMultiplier;
        
          // 更新订单簿的lastPrice
          newBook = {
            ...input.book,
            lastPrice: finalPrice,
            marketMode: 'cex',
          };
        
          // 现货价格完全由盘口与随机波动决定
        } else {
          // ========== 有玩家挂单/做市商做市/价差超限：CEX 盘口价格模式 ==========
          // CEX 盘口保持不变（基准价格已在 generateNextPeriodOrderBook 中调整）
          newBook = {
            ...input.book,
            lastPrice: cexPrice,
            marketMode: 'cex',
          };
        
          // 最终价格仅采用 CEX 价格
          finalPrice = cexPrice;
        }
      
        // 【修改】K线收盘价仅参考 CEX 价格与随机波动机制，不再参考 DEX 价格（移除原有的 DEX 50% 权重）
        // 【修复0%波动】收盘价取市场第一档价格（跳过玩家挂单），与 lastPrice 的
        // "当前价格 = 市场买一价（跳过玩家挂单）"逻辑保持一致；否则玩家高于市价的
        // 静态限价买单会持续占据买一档，把K线收盘价钉死在固定价格上，导致后续回合波动为0%
        const klineMarketBids = newBook.bids.filter(b => !b.isPlayer);
        const klineMarketAsks = newBook.asks.filter(a => !a.isPlayer);
        const cexTopBidPrice = klineMarketBids[0]?.price;
        const cexTopAskPrice = klineMarketAsks[0]?.price;
        let orderBookPrice = cexTopBidPrice || cexTopAskPrice || finalPrice;
        // 【修复0%波动】兜底：若本回合涨跌幅为0（收盘价等于开盘价）或低于最小可感知幅度，
        // 按tier随机波动下限施加随机偏移，保证每回合K线都有非零波动
        let candleClose = orderBookPrice;
        {
          const guardOpenPrice = Math.max(0.00001, input.newCandle.open);
          const guardChangeRatio = (candleClose - guardOpenPrice) / guardOpenPrice;
          // 【修复波动率异常】纯随机模式（无玩家挂单、无做市商做市、无事件影响）下，
          // 将最终K线涨跌幅严格钳制在tier波动范围内：
          // 巨鲸 0.1%-0.2%、巨型 0.2%-0.5%、大型 0.3%-1%、中型 0.5%-2%、小型 1%-3%、微型 2%-5%
          // 既杜绝0%波动，也防止热板块/双随机叠加导致单回合波动超出tier上限；
          // 事件公布回合（input.eventMultiplier≠1）保留事件本身的更大波动幅度
          const isPureRandomRound = !hasPlayerOrders && !input.forcePriceLinkage && Math.abs(input.eventMultiplier - 1) < 1e-9;
          if (isPureRandomRound) {
            // 钳制范围随随机波动加成同步放大（异常大波动后波动率提升n%/10并逐回合衰减）
            const { volMin: guardBaseMin, volMax: guardBaseMax } = getTierVolatilityRange(getMechanicsTier(input.token));
            const guardVolBoost = input.token.volBoostPct || 0;
            const effGuardMin = guardBaseMin + guardVolBoost;
            const effGuardMax = guardBaseMax + guardVolBoost;
            // 先按有效上限钳制（保留原方向），再保证不低于有效下限（杜绝0%波动）
            let boundedMove = Math.max(-effGuardMax, Math.min(effGuardMax, guardChangeRatio));
            if (Math.abs(boundedMove) < effGuardMin) {
              boundedMove = (boundedMove >= 0 ? 1 : -1) * effGuardMin;
            }
            candleClose = guardOpenPrice * (1 + boundedMove);
            // 同步订单簿价格，保证K线收盘价、代币当前价格与涨跌幅计算一致
            orderBookPrice = candleClose;
          } else if (Math.abs(guardChangeRatio) < 0.00005) { // 非纯随机模式：0.005%以内视为0波动
            const { volMin: guardBaseMin } = getTierVolatilityRange(getMechanicsTier(input.token));
            const guardVolBoost = input.token.volBoostPct || 0;
            const effGuardMin = guardBaseMin + guardVolBoost;
            const guardDir = rnd() > 0.5 ? 1 : -1;
            candleClose = guardOpenPrice * (1 + guardDir * effGuardMin * (0.5 + rnd() * 0.5));
            // 同步订单簿价格，保证K线收盘价、代币当前价格与涨跌幅计算一致
            orderBookPrice = candleClose;
          }
        }
        // 【修复波动率异常】纯随机模式下，将订单簿lastPrice与最终价格同步为
        // K线收盘价，避免lastPrice走另一条独立随机链，造成盘口价格与K线不一致
        if (!hasPlayerOrders && !input.forcePriceLinkage) {
          newBook = { ...newBook, lastPrice: candleClose };
          finalPrice = candleClose;
        }
        // 【重要】收盘价修正后，按当回合涨跌方向重新确定最高/最低价的浮动基准
        // 与 calculateNextCandle 规则保持一致：
        // 当回合K线为涨（收盘价 >= 开盘价）：最高价根据收盘价向上浮动（tier浮动），
        //   最低价根据开盘价向下浮动（tier浮动）
        // 当回合K线为跌（收盘价 < 开盘价）：最高价根据开盘价向上浮动（tier浮动），
        //   最低价根据收盘价向下浮动（tier浮动）
        const openPrice = input.newCandle.open;
        const safeCandleClose = Math.max(0.00001, candleClose);
        const candleTier = getMechanicsTier(input.token);
        // 【修复】统一使用 getTierHighLowFloatRange 的tier浮动范围（与初始化K线/calculateNextCandle一致）：
        // 巨鲸 0.01%-0.15%；巨型 0.05%-0.3%；大型 0.1%-0.5%；中型 0.2%-1%；小型 0.5%-2%；微型 1%-3%
        const { floatMin: candleFloatMin, floatMax: candleFloatMax } = getTierHighLowFloatRange(candleTier);
        // 【随机波动加成】最高价最低价的波动同步提升 n%/20（n为异常波动幅度，即波动加成的一半）
        const candleHighLowBoost = (input.token.volBoostPct || 0) / 2;
        const effCandleFloatMin = candleFloatMin + candleHighLowBoost;
        const effCandleFloatMax = candleFloatMax + candleHighLowBoost;
        const candleTierFloat = effCandleFloatMin + rnd() * (effCandleFloatMax - effCandleFloatMin);
        let candleHigh: number;
        let candleLow: number;
        if (safeCandleClose >= openPrice) {
          // 当回合为涨：最高价根据收盘价向上浮动（tier浮动），最低价根据开盘价向下浮动
          candleHigh = safeCandleClose * (1 + candleTierFloat);
          candleLow = openPrice * (1 - candleTierFloat);
        } else {
          // 当回合为跌：最高价根据开盘价向上浮动，最低价根据收盘价向下浮动（tier浮动）
          candleHigh = openPrice * (1 + candleTierFloat);
          candleLow = safeCandleClose * (1 - candleTierFloat);
        }
        // 确保最高价 >= 收盘价 >= 最低价，并防止价格为0或负数
        // 【修复】下限保护不能放进 Math.min：0.00001 作为 min 的输入会把每根K线最低价
        // 强制钳制为固定极小值，导致所有K线最低价都变成 0.00001。先取真实最低价，再单独做下限保护。
        candleHigh = Math.max(candleHigh, openPrice, safeCandleClose);
        candleLow = Math.min(candleLow, openPrice, safeCandleClose);
        candleLow = Math.max(0.00001, candleLow);
      
        // ========== 强平金额推高/压低K线高低价（AI强平） ==========
        // 规则：空头强平推高最高价、多头强平推低最低价（与 calculateNextCandle 一致）
        // 浮动量 = 强平金额 / (市值 × 20)，空头最多推高25%，多头最多压低20%
        // 玩家与散户强平发生在K线生成之后，由后续统一强平叠加逻辑处理
        if (input.aiLiquidationInfo && (input.aiLiquidationInfo.shortLiquidationAmount > 0 || input.aiLiquidationInfo.longLiquidationAmount > 0)) {
          const liqCandleMarketCap = input.token.circulatingSupply * safeCandleClose;
          if (liqCandleMarketCap > 0) {
            if (input.aiLiquidationInfo.shortLiquidationAmount > 0) {
              const shortBoost = Math.min(input.aiLiquidationInfo.shortLiquidationAmount / (liqCandleMarketCap * 20), 0.25);
              if (shortBoost > 0) {
                candleHigh = Math.max(candleHigh, safeCandleClose * (1 + shortBoost));
              }
            }
            if (input.aiLiquidationInfo.longLiquidationAmount > 0) {
              const longDrop = Math.min(input.aiLiquidationInfo.longLiquidationAmount / (liqCandleMarketCap * 20), 0.2);
              if (longDrop > 0) {
                candleLow = Math.min(candleLow, safeCandleClose * (1 - longDrop));
              }
            }
          }
        }
        // 再次确保最高价 >= 收盘价 >= 最低价
        candleHigh = Math.max(candleHigh, openPrice, safeCandleClose);
        candleLow = Math.min(candleLow, openPrice, safeCandleClose);
        candleLow = Math.max(0.00001, candleLow);
      
        const updatedCandle = {
          ...input.newCandle,
          close: safeCandleClose,
          high: candleHigh,
          low: candleLow,
        };
      
        // 更新K线
        // 所有代币保留完整K线历史，无数量限制
        const newCandles = [...input.prevCandles, updatedCandle];
            

  return { newBook, finalPrice, orderBookPrice, newPool, updatedCandle, newCandles };
}

/** 【域一收口-2b】纯价格/趋势字段计算：不触热度、不触下架、不改传入 token */
export interface PriceTrendInput {
  token: Token;
  orderBookPrice: number;
  newRound: number;
  safeInitialPrice: number;
  hourlyPrices: Array<{ hour: number; price: number }>;
  safePrevRoundPrice: number;
  prevDirection: 'up' | 'down' | 'flat';
  prevTrendStartPrice: number;
}
export interface PriceTrendFields {
  currentPrice: number;
  marketCap: number;
  change24h: number;
  athPrice: number;
  lastRoundChange: number;
  trendDirection: 'up' | 'down' | 'flat';
  trendStartPrice: number;
}

export function computePriceTrendFields(input: PriceTrendInput): PriceTrendFields {
  const { token, orderBookPrice, newRound, safeInitialPrice, hourlyPrices, safePrevRoundPrice, prevDirection, prevTrendStartPrice } = input;

  const price24hAgo = (() => {
    const targetHour = newRound - 24;
    let p = safeInitialPrice;
    if (targetHour >= 0 && hourlyPrices.length > 0) {
      const priceRecord = hourlyPrices.find(h => h.hour === targetHour);
      if (priceRecord) {
        p = priceRecord.price;
      } else {
        const earlierPrices = hourlyPrices.filter(h => h.hour <= targetHour);
        if (earlierPrices.length > 0) {
          earlierPrices.sort((a, b) => b.hour - a.hour);
          p = earlierPrices[0].price;
        }
      }
    }
    return p;
  })();

  const finalChange = (orderBookPrice - safePrevRoundPrice) / safePrevRoundPrice;
  const finalDirection: 'up' | 'down' | 'flat' = finalChange > 0.001 ? 'up' : finalChange < -0.001 ? 'down' : 'flat';
  const trendStartPrice = finalDirection === 'flat'
    ? safePrevRoundPrice
    : finalDirection === prevDirection
      ? prevTrendStartPrice
      : safePrevRoundPrice;

  return {
    currentPrice: orderBookPrice,
    marketCap: orderBookPrice * token.totalSupply,
    change24h: ((orderBookPrice - price24hAgo) / price24hAgo) * 100,
    athPrice: Math.max(token.athPrice, orderBookPrice),
    lastRoundChange: finalChange,
    trendDirection: finalDirection,
    trendStartPrice,
  };
}

// ==========================================================================
// 【Stage3-B3·域二-pre】合约盘口重建（原 handleFastForward 13317–13483 段）
// 纯函数：只读入参，返回全新合约盘口 + 玩家订单成交量；不触 React、不改入参对象。
// 早期返回（未上架合约 / 交易所宕机）由调用方保留，不属于盘口计算。
// ==========================================================================
export interface FuturesBookInput {
  token: Token;
  /** 本回合更新后的现货价（token.currentPrice） */
  newSpotPrice: number;
  /** 本回合已生成的现货盘口 */
  spotOrderBook: Level2OrderBook | null;
  /** 吃单后的合约盘口（含更新后的玩家挂单），可能为 null */
  afterFillBook: FuturesOrderBook | null;
  /** 吃单后的实时价格（缺省用标记价） */
  afterFillPrice?: number;
  /** 该交易对资金费率 */
  fundingRate: number;
  playerHoldingQuantity: number;
  aiHoldingQuantity: number;
  marketMakerHoldingQuantity: number;
  /** 当前热度 0-100 */
  heat: number;
  /** 观察标签代币：合约盘口订单减半 */
  isWatched: boolean;
  /** 即将下架：合约盘口订单减半 */
  isDelistPending: boolean;
  /** 做市商破产等：合约盘口订单减半 */
  isOrderReduced: boolean;
}

export interface FuturesBookPlayerFill {
  orderId: string;
  tokenId: string;
  filledQuantity: number;
  filledTokenQty: number;
  avgPrice: number;
}

export interface FuturesBookResult {
  book: FuturesOrderBook;
  playerOrderFills: FuturesBookPlayerFill[];
}

export function computeFuturesBookForToken(input: FuturesBookInput): FuturesBookResult {
  const { token, spotOrderBook, afterFillBook, fundingRate } = input;

  // ---------- 标记价格：现货买一价与合约买一价的几何平均数（±2% 限制） ----------
  const spotBidOne = spotOrderBook?.bids[0]?.price || 0;
  const spotAskOne = spotOrderBook?.asks[0]?.price || 0;
  const spotPrice = spotBidOne > 0 ? spotBidOne : (spotAskOne > 0 ? spotAskOne : 0);
  const futuresBidOne = afterFillBook?.bids[0]?.price || 0;

  let markPrice: number;
  if (spotPrice > 0 && futuresBidOne > 0) {
    const geometricMean = Math.sqrt(spotPrice * futuresBidOne);
    const priceDiff = (futuresBidOne - spotPrice) / spotPrice;
    if (Math.abs(priceDiff) > 0.02) {
      markPrice = spotPrice * (1 + Math.sign(priceDiff) * 0.01);
    } else {
      markPrice = geometricMean;
    }
  } else if (spotPrice > 0) {
    markPrice = spotPrice;
  } else if (futuresBidOne > 0) {
    markPrice = futuresBidOne;
  } else {
    markPrice = token.currentPrice;
  }
  markPrice = Math.max(0.0000001, markPrice);

  // ---------- 吃单后价格与标记价偏差超过 2% 时限制在 2% 以内 ----------
  let afterFillPrice = input.afterFillPrice || markPrice;
  if (markPrice > 0 && afterFillPrice > 0) {
    const priceDiff = (afterFillPrice - markPrice) / markPrice;
    if (Math.abs(priceDiff) > 0.02) {
      afterFillPrice = markPrice * (1 + Math.sign(priceDiff) * 0.02);
    }
  }

  // ---------- 连续涨跌累计涨跌幅 ----------
  let tokenCumulativeChange = 0;
  const tokenTrendDirection = token.trendDirection || 'flat';
  const tokenTrendStartPrice = token.trendStartPrice || token.currentPrice;
  if (tokenTrendDirection === 'up' || tokenTrendDirection === 'down') {
    const safeTrendStartPrice = tokenTrendStartPrice > 0.0001 ? tokenTrendStartPrice : 0.0001;
    tokenCumulativeChange = (token.currentPrice - safeTrendStartPrice) / safeTrendStartPrice;
  } else {
    tokenCumulativeChange = token.lastRoundChange || 0;
  }

  // ---------- 有效市值：各方持仓占比 ----------
  const circulating = token.circulatingSupply;
  const playerHoldingRatioForFutures = circulating > 0 ? input.playerHoldingQuantity / circulating : 0;
  const aiHoldingRatioForFutures = circulating > 0 ? input.aiHoldingQuantity / circulating : 0;
  const marketMakerHoldingRatioForFutures = circulating > 0 ? input.marketMakerHoldingQuantity / circulating : 0;

  // ---------- 盘口订单量缩放（观察/即将下架/订单收缩各自减半） ----------
  const orderScale = (input.isWatched ? 0.5 : 1) * (input.isDelistPending ? 0.5 : 1) * (input.isOrderReduced ? 0.5 : 1);

  // ---------- 玩家自留占比（自留按流通量折算豁免，与现货一致） ----------
  const playerReservedRatioForFutures = token.isPlayerCreated && token.playerReservedAmount && token.circulatingSupply
    ? Math.min(1, token.playerReservedAmount / token.circulatingSupply)
    : 0;

  const newFuturesBook = generateFuturesOrderBook(
    token,
    afterFillPrice,
    afterFillBook || null,
    fundingRate,
    markPrice,
    token.marketingEffect,
    tokenCumulativeChange,
    playerHoldingRatioForFutures,
    aiHoldingRatioForFutures,
    marketMakerHoldingRatioForFutures,
    orderScale,
    spotOrderBook,
    input.heat,
    playerReservedRatioForFutures
  );

  const updatedFundingRate = calculateFundingRate(newFuturesBook.lastPrice, markPrice, getFundingConfig(getTokenTier(token)).maxRate);

  const book: FuturesOrderBook = {
    ...newFuturesBook,
    markPrice,
    indexPrice: input.newSpotPrice,
    fundingRate: updatedFundingRate,
  };

  const playerOrderFills: FuturesBookPlayerFill[] = newFuturesBook.playerOrderFills && Object.keys(newFuturesBook.playerOrderFills).length > 0
    ? Object.entries(newFuturesBook.playerOrderFills).map(([orderId, fill]) => ({
        orderId,
        tokenId: token.id,
        filledQuantity: fill.filledQuantity,
        filledTokenQty: fill.filledTokenQty,
        avgPrice: fill.avgPrice,
      }))
    : [];

  return { book, playerOrderFills };
}

// ==========================================================================
// 【Stage3-B3·域二-1】现货限价单撮合（原 handleFastForward 12711–12902 段）
// 纯函数：只读入参，返回增量（订单/持仓/资金/冻结/库存/历史/新盘口）。
// 彻底移除原实现中「在 setOrders(prev => …) 里再调 setState + showToast」的副作用。
// ==========================================================================
export interface SpotLimitMatchInput {
  /** 全部现货订单（仅处理 tokenId 匹配且 pending 的订单，其余 pending 订单原样保留） */
  orders: Order[];
  tokenId: string;
  tokenName: string;
  tokenCode: string;
  /** 本回合生成的现货盘口（含 playerOrderFills） */
  book: Level2OrderBook;
  /** 成交时间戳（由调用方传入 Date.now()，纯函数内不取时间） */
  filledAt: number;
  /** 订单/历史 ID 生成器（显式注入，避免纯函数依赖全局随机） */
  makeId: () => string;
  /** 手续费率，默认 0.001 */
  feeRate?: number;
}

export interface SpotPositionDelta {
  tokenId: string;
  /** 持仓数量增量（买入为正、卖出为负） */
  quantityDelta: number;
  /** 买入成本增量（卖出为 0） */
  costDelta: number;
  /** 成交时用于重估市值的价格（撮合后盘口 lastPrice） */
  marketPrice: number;
  side: 'buy' | 'sell';
}

export interface SpotLimitMatchResult {
  /** 新的订单列表（与原实现一致：只保留仍需 pending 的订单） */
  updatedOrders: Order[];
  orderHistory: OrderHistory[];
  positionDeltas: SpotPositionDelta[];
  /** 可用资金净变动（含冻结释放与限价差额返还） */
  cashDelta: number;
  /** 冻结资金净变动（负数=释放） */
  frozenDelta: number;
  /** 玩家 CEX 现货可用余额的逐笔变动（买入 +，卖出 −），保持原调用顺序 */
  cexBalanceDeltas: number[];
  updatedBook: Level2OrderBook;
  filledOrderCount: number;
}

export function matchSpotLimitOrders(input: SpotLimitMatchInput): SpotLimitMatchResult {
  const { orders, tokenId, tokenName, tokenCode, book, filledAt, makeId } = input;
  const feeRate = input.feeRate ?? 0.001;

  const updatedOrders: Order[] = [];
  const orderHistory: OrderHistory[] = [];
  const positionDeltas: SpotPositionDelta[] = [];
  const cexBalanceDeltas: number[] = [];
  let cashDelta = 0;
  let frozenDelta = 0;
  let filledOrderCount = 0;

  // 与原实现一致：只复制数组，档位条目按原逻辑就地修改（generatedBook 本回合新建、无对外引用）
  const newBook: Level2OrderBook = { ...book, bids: [...book.bids], asks: [...book.asks] };
  const playerOrderFills = book.playerOrderFills || {};

  orders.forEach(order => {
    if (order.status !== 'pending') return;

    if (order.tokenId !== tokenId) {
      updatedOrders.push(order);
      return;
    }

    const remainingQty = order.quantity - order.filledQuantity;
    if (remainingQty <= 0) return;

    let filledQty = 0;
    let totalCost = 0;

    // 盘口撮合阶段已成交的部分
    const bookFill = playerOrderFills[order.id];
    if (bookFill && bookFill.quantity > 0) {
      filledQty = Math.min(bookFill.quantity, remainingQty);
      totalCost = filledQty * bookFill.avgPrice;
    }

    // 买单：卖一价 <= 限价 时成交（跳过玩家自己的卖单）
    if (order.side === 'buy' && filledQty < remainingQty) {
      for (let i = 0; i < newBook.asks.length && filledQty < remainingQty; i++) {
        const ask = newBook.asks[i];
        if (ask.isPlayer) continue;
        if (ask.price <= order.price) {
          const fillQty = Math.min(remainingQty - filledQty, ask.quantity);
          if (fillQty > 0) {
            totalCost += fillQty * ask.price;
            filledQty += fillQty;
            ask.quantity -= fillQty;
            ask.total = ask.price * ask.quantity;
          }
        } else {
          break;
        }
      }
    } else if (order.side === 'sell' && filledQty < remainingQty) {
      // 卖单：买一价 >= 限价 时成交（跳过玩家自己的买单）
      for (let i = 0; i < newBook.bids.length && filledQty < remainingQty; i++) {
        const bid = newBook.bids[i];
        if (bid.isPlayer) continue;
        if (bid.price >= order.price) {
          const fillQty = Math.min(remainingQty - filledQty, bid.quantity);
          if (fillQty > 0) {
            totalCost += fillQty * bid.price;
            filledQty += fillQty;
            bid.quantity -= fillQty;
            bid.total = bid.price * bid.quantity;
          }
        } else {
          break;
        }
      }
    }

    if (filledQty > 0) {
      const newFilledQuantity = order.filledQuantity + filledQty;
      const nextOrder: Order = {
        ...order,
        filledQuantity: newFilledQuantity,
        status: newFilledQuantity >= order.quantity ? 'filled' : 'pending',
      };

      cexBalanceDeltas.push(order.side === 'buy' ? filledQty : -filledQty);

      if (order.side === 'buy') {
        positionDeltas.push({ tokenId: order.tokenId, quantityDelta: filledQty, costDelta: totalCost, marketPrice: newBook.lastPrice, side: 'buy' });
        frozenDelta -= order.price * filledQty;
        cashDelta += order.price * filledQty - totalCost;
      } else {
        positionDeltas.push({ tokenId: order.tokenId, quantityDelta: -filledQty, costDelta: 0, marketPrice: newBook.lastPrice, side: 'sell' });
        cashDelta += totalCost;
      }

      orderHistory.push({
        id: makeId(),
        tokenId: order.tokenId,
        tokenName,
        tokenCode,
        orderType: 'limit',
        side: order.side,
        price: totalCost / filledQty,
        quantity: filledQty,
        amount: totalCost,
        fee: totalCost * feeRate,
        filledAt,
      });

      filledOrderCount += 1;
      if (nextOrder.status === 'pending') updatedOrders.push(nextOrder);
    } else {
      updatedOrders.push(order);
    }
  });

  // 清理盘口中数量为 0 的订单
  newBook.asks = newBook.asks.filter(a => a.quantity > 0.001);
  newBook.bids = newBook.bids.filter(b => b.quantity > 0.001);
  newBook.totalAskQuantity = newBook.asks.reduce((sum, a) => sum + a.quantity, 0);
  newBook.totalBidQuantity = newBook.bids.reduce((sum, b) => sum + b.quantity, 0);

  // 更新盘口价格（跳过玩家挂单）
  const newBestBid = newBook.bids.find(b => !b.isPlayer)?.price;
  const newBestAsk = newBook.asks.find(a => !a.isPlayer)?.price;
  if (newBestBid && newBestAsk && newBestAsk <= newBestBid) {
    newBook.lastPrice = newBestAsk;
  } else if (newBestBid) {
    newBook.lastPrice = newBestBid;
  } else if (newBestAsk) {
    newBook.lastPrice = newBestAsk;
  }

  return {
    updatedOrders,
    orderHistory,
    positionDeltas,
    cashDelta,
    frozenDelta,
    cexBalanceDeltas,
    updatedBook: newBook,
    filledOrderCount,
  };
}

/**
 * 把现货成交的持仓增量应用到持仓数组（纯函数，返回全新数组）。
 * 买入：加仓并重算 avgCost；卖出：减仓，剩余 <= 0.0001 时移除（与原实现一致）。
 */
export function applySpotPositionDeltas(
  positions: Position[],
  deltas: SpotPositionDelta[],
  makeId: () => string
): Position[] {
  if (deltas.length === 0) return positions;
  let next = positions;

  deltas.forEach(delta => {
    if (delta.side === 'buy') {
      const absQty = delta.quantityDelta;
      const existing = next.find(p => p.tokenId === delta.tokenId);
      if (existing) {
        const newQty = existing.quantity + absQty;
        const newCost = existing.avgCost * existing.quantity + delta.costDelta;
        const safeNewQty = newQty > 0.0001 ? newQty : 0.0001;
        next = next.map(p =>
          p.tokenId === delta.tokenId
            ? { ...p, quantity: newQty, avgCost: newCost / safeNewQty, currentPrice: delta.marketPrice, marketValue: newQty * delta.marketPrice }
            : p
        );
      } else {
        const safeFilledQty = absQty > 0.0001 ? absQty : 0.0001;
        next = [...next, {
          id: makeId(),
          tokenId: delta.tokenId,
          quantity: absQty,
          avgCost: delta.costDelta / safeFilledQty,
          currentPrice: delta.marketPrice,
          marketValue: absQty * delta.marketPrice,
          profitLoss: 0,
        }];
      }
    } else {
      const sellQty = -delta.quantityDelta;
      const index = next.findIndex(p => p.tokenId === delta.tokenId);
      if (index >= 0) {
        const pos = next[index];
        const newQty = pos.quantity - sellQty;
        if (newQty <= 0.0001) {
          next = next.filter(p => p.tokenId !== delta.tokenId);
        } else {
          next = next.map((p, i) =>
            i === index
              ? { ...p, quantity: newQty, currentPrice: delta.marketPrice, marketValue: newQty * delta.marketPrice }
              : p
          );
        }
      }
    }
  });

  return next;
}

/** 合约限价单撮合：一笔成交记录（供 App 侧更新持仓/资金） */
export interface FuturesLimitFill {
  orderId: string;
  tokenId: string;
  side: 'open_long' | 'open_short' | 'close_long' | 'close_short';
  filledValue: number;
  filledTokenQty: number;
  totalCost: number;
  avgPrice: number;
}

export interface FuturesLimitMatchInput {
  /** 玩家合约挂单（只读，函数内不会修改） */
  orders: FuturesOrder[];
  /** 旧合约盘口映射（只读，函数内深拷贝后修改副本） */
  bookMap: Record<string, FuturesOrderBook>;
  /** 交易所宕机当回合：所有挂单保留 pending，不参与撮合 */
  exchangeDown: boolean;
  /** 禁开仓代币（监管叫停/保险基金不足）：开仓单保留 pending */
  openBlockedTokenIds: Set<string>;
}

export interface FuturesLimitMatchResult {
  /** 撮合后的挂单列表（成交单保留 status=filled，未成交/部分成交保持 pending） */
  processedOrders: FuturesOrder[];
  /** 成交列表（按订单遍历顺序） */
  filledOrders: FuturesLimitFill[];
  /** 吃单后更新过的盘口（深拷贝，供交叉盘撮合/新盘口生成继续使用） */
  updatedBooks: Record<string, FuturesOrderBook>;
}

/**
 * 【Stage3-B3·域二-2】合约限价单撮合（纯函数）
 *
 * 逐字搬运原 handleFastForward 内的同步撮合段：
 *   - 开多/平空吃卖盘（价 <= 限价），开空/平多吃买盘（价 >= 限价），跳过玩家自己的挂单；
 *   - 数量以 **USDT 名义价值** 计（剩余量 - 已成交量），成交代币数按档位价格换算；
 *   - 完全成交从盘口移除玩家挂单，部分成交按 orderId 回写剩余数量；
 *   - 返回全新 order 对象（filledQuantity/filledTokenQty/totalCost/status 均为不可变赋值）。
 */
export function matchFuturesLimitOrders(input: FuturesLimitMatchInput): FuturesLimitMatchResult {
  const { orders, bookMap, exchangeDown, openBlockedTokenIds } = input;

  const processedOrders: FuturesOrder[] = [];
  const filledOrders: FuturesLimitFill[] = [];
  const updatedBooks: Record<string, FuturesOrderBook> = {};

  orders.forEach(sourceOrder => {
    let order = sourceOrder;

    if (order.status !== 'pending') {
      processedOrders.push(order);
      return;
    }

    if (exchangeDown) {
      processedOrders.push(order);
      return;
    }

    if ((order.side === 'open_long' || order.side === 'open_short') && openBlockedTokenIds.has(order.tokenId)) {
      processedOrders.push(order);
      return;
    }

    let orderBook = updatedBooks[order.tokenId];
    if (!orderBook) {
      const oldBook = bookMap[order.tokenId];
      if (oldBook) {
        // 深拷贝订单条目：多个订单共享同一引用会互相干扰
        orderBook = {
          ...oldBook,
          bids: oldBook.bids.map(b => ({ ...b })),
          asks: oldBook.asks.map(a => ({ ...a })),
          playerOrderFills: oldBook.playerOrderFills ? { ...oldBook.playerOrderFills } : {},
        };
        updatedBooks[order.tokenId] = orderBook;
      }
    }

    if (!orderBook) {
      processedOrders.push(order);
      return;
    }

    const remainingQty = order.quantity - order.filledQuantity;
    if (remainingQty <= 0) {
      processedOrders.push(order);
      return;
    }

    let filledValue = 0;
    let filledTokenQty = 0;
    let totalCost = 0;

    const consumeLevel = (level: { price: number; quantity: number; total: number }): boolean => {
      const levelValue = level.quantity * level.price;
      const remainingValue = remainingQty - filledValue;
      if (levelValue <= remainingValue) {
        filledValue += levelValue;
        filledTokenQty += level.quantity;
        totalCost += levelValue;
        level.quantity = 0;
        level.total = 0;
      } else {
        const fillValue = remainingValue;
        const fillQuantity = fillValue / level.price;
        filledValue = remainingQty;
        filledTokenQty += fillQuantity;
        totalCost += fillValue;
        level.quantity -= fillQuantity;
        level.total = level.price * level.quantity;
      }
      return filledValue < remainingQty;
    };

    // 开多/平空吃卖盘（价 <= 限价）；开空/平多吃买盘（价 >= 限价）
    if (order.side === 'open_long' || order.side === 'close_short') {
      for (let i = 0; i < orderBook.asks.length && filledValue < remainingQty; i++) {
        const ask = orderBook.asks[i];
        if (ask.isPlayer) continue;
        if (ask.price <= order.price) {
          if (!consumeLevel(ask)) break;
        } else {
          break;
        }
      }
    } else {
      for (let i = 0; i < orderBook.bids.length && filledValue < remainingQty; i++) {
        const bid = orderBook.bids[i];
        if (bid.isPlayer) continue;
        if (bid.price >= order.price) {
          if (!consumeLevel(bid)) break;
        } else {
          break;
        }
      }
    }

    if (filledValue > 0) {
      const newFilledQuantity = order.filledQuantity + filledValue;
      const newFilledTokenQty = (order.filledTokenQty || 0) + filledTokenQty;
      const newTotalCost = (order.totalCost || 0) + totalCost;
      const avgPrice = filledTokenQty > 0 ? totalCost / filledTokenQty : order.price;

      filledOrders.push({
        orderId: order.id,
        tokenId: order.tokenId,
        side: order.side,
        filledValue,
        filledTokenQty,
        totalCost,
        avgPrice,
      });

      const isFullyFilled = newFilledQuantity >= order.quantity;
      const nextOrder: FuturesOrder = isFullyFilled
        ? { ...order, filledQuantity: order.quantity, filledTokenQty: newFilledTokenQty, totalCost: newTotalCost, status: 'filled' }
        : { ...order, filledQuantity: newFilledQuantity, filledTokenQty: newFilledTokenQty, totalCost: newTotalCost };
      processedOrders.push(nextOrder);
      order = nextOrder;

      // 盘口玩家挂单：完全成交移除，部分成交按 orderId 回写剩余名义价值
      const onBidBook = order.side === 'open_long' || order.side === 'close_short';
      const bookLevels = onBidBook ? orderBook.bids : orderBook.asks;
      const playerIndex = bookLevels.findIndex(level => level.isPlayer && level.orderId === order.id);
      if (playerIndex >= 0) {
        if (isFullyFilled) {
          bookLevels.splice(playerIndex, 1);
        } else {
          const unfilledValue = order.quantity - newFilledQuantity;
          const target = bookLevels[playerIndex];
          target.quantity = unfilledValue / order.price;
          target.total = unfilledValue;
        }
      }
    } else {
      processedOrders.push(order);
    }
  });

  return { processedOrders, filledOrders, updatedBooks };
}

/** 合约交叉盘撮合中的一笔玩家成交 */
export interface FuturesCrossMatchFill {
  orderId: string;
  tokenId: string;
  side: 'open_long' | 'open_short' | 'close_long' | 'close_short';
  filledValue: number;
  filledTokenQty: number;
  avgPrice: number;
}

export interface FuturesCrossMatchInput {
  /** 限价单撮合后的盘口（from matchFuturesLimitOrders().updatedBooks，函数内再次深拷贝） */
  books: Record<string, FuturesOrderBook>;
  /** 交易所宕机当回合：跳过交叉盘撮合，仅保留盘口 */
  skip: boolean;
  /** 禁开仓代币：跳过其交叉盘撮合 */
  openBlockedTokenIds: Set<string>;
}

export interface FuturesCrossMatchResult {
  /** 交叉盘撮合后的全新盘口（已清理 0 量档位并重算总量） */
  books: Record<string, FuturesOrderBook>;
  /** 交叉盘中玩家挂单的成交记录（开多=买一被吃，开空=卖一被吃；平仓单沿用同侧语义） */
  fills: FuturesCrossMatchFill[];
  /** 吃单后的实时价格（买一价；无买盘回退 lastPrice） */
  afterFillPrices: Record<string, number>;
}

/**
 * 【Stage3-B3·域二-3】合约交叉盘撮合（纯函数）
 *
 * 玩家限价单与旧盘口撮合后可能出现「买一 >= 卖一」的交叉盘，这里按卖一价循环撮合（最多 10 轮）。
 * 逐字搬运原实现：0 量档位清理、买卖盘排序、玩家成交只记录不结算（结算在 App 侧落账段统一做）。
 */
export function matchFuturesCrossBook(input: FuturesCrossMatchInput): FuturesCrossMatchResult {
  const { books, skip, openBlockedTokenIds } = input;
  const outBooks: Record<string, FuturesOrderBook> = {};
  const fills: FuturesCrossMatchFill[] = [];
  const afterFillPrices: Record<string, number> = {};

  Object.keys(books).forEach(tokenId => {
    const source = books[tokenId];
    const book: FuturesOrderBook = {
      ...source,
      bids: source.bids.map(b => ({ ...b })),
      asks: source.asks.map(a => ({ ...a })),
      playerOrderFills: source.playerOrderFills ? { ...source.playerOrderFills } : {},
    };
    outBooks[tokenId] = book;

    if (skip) return;
    if (openBlockedTokenIds.has(tokenId)) return;

    book.asks = book.asks.filter(a => a.quantity > 0.001);
    book.bids = book.bids.filter(b => b.quantity > 0.001);

    book.bids.sort((a, b) => b.price - a.price);
    book.asks.sort((a, b) => a.price - b.price);

    let crossMatchRounds = 0;
    const MAX_CROSS_MATCH_ROUNDS = 10;

    while (book.bids.length > 0 && book.asks.length > 0 && crossMatchRounds < MAX_CROSS_MATCH_ROUNDS) {
      const bestBid = book.bids[0];
      const bestAsk = book.asks[0];

      if (bestBid.price >= bestAsk.price) {
        const matchQuantity = Math.min(bestBid.quantity, bestAsk.quantity);

        if (matchQuantity > 0.001) {
          const matchPrice = bestAsk.price; // 以卖一价成交

          if (bestBid.isPlayer && bestBid.orderId) {
            fills.push({
              orderId: bestBid.orderId,
              tokenId,
              side: 'open_long',
              filledValue: matchQuantity * matchPrice,
              filledTokenQty: matchQuantity,
              avgPrice: matchPrice,
            });
          }

          if (bestAsk.isPlayer && bestAsk.orderId) {
            fills.push({
              orderId: bestAsk.orderId,
              tokenId,
              side: 'open_short',
              filledValue: matchQuantity * matchPrice,
              filledTokenQty: matchQuantity,
              avgPrice: matchPrice,
            });
          }

          bestBid.quantity -= matchQuantity;
          bestAsk.quantity -= matchQuantity;
          bestBid.total = bestBid.price * bestBid.quantity;
          bestAsk.total = bestAsk.price * bestAsk.quantity;
        }

        if (bestBid.quantity <= 0.001) {
          book.bids.shift();
        }
        if (bestAsk.quantity <= 0.001) {
          book.asks.shift();
        }

        crossMatchRounds++;
      } else {
        break;
      }
    }

    book.totalAskQuantity = book.asks.reduce((sum, a) => sum + a.quantity, 0);
    book.totalBidQuantity = book.bids.reduce((sum, b) => sum + b.quantity, 0);

    afterFillPrices[tokenId] = book.bids.length > 0 ? book.bids[0].price : book.lastPrice;
  });

  return { books: outBooks, fills, afterFillPrices };
}

/** 本回合某订单的成交汇总（统一结构，供持仓落账与域三强平引擎复用） */
export interface FuturesFillRecord {
  orderId: string;
  tokenId: string;
  side: 'open_long' | 'open_short' | 'close_long' | 'close_short';
  filledValue: number;
  filledTokenQty: number;
  avgPrice: number;
  leverage: number;
}

/** 盘口生成阶段（第二部分）玩家订单成交 */
export interface FuturesBookPartFill {
  orderId: string;
  tokenId: string;
  filledQuantity: number;
  filledTokenQty: number;
  avgPrice: number;
}

export interface FuturesOrderMergeInput {
  /** 回合开始时的全部合约挂单 */
  orders: FuturesOrder[];
  /** matchFuturesLimitOrders().processedOrders：第一部分处理后的订单状态 */
  processedOrders: FuturesOrder[];
  /** matchFuturesLimitOrders().filledOrders：第一部分成交 */
  fills: FuturesLimitFill[];
  /** matchFuturesCrossBook().fills：交叉盘成交 */
  crossFills: FuturesCrossMatchFill[];
  /** 盘口生成阶段的玩家成交（allPlayerOrderFills，按代币分组） */
  secondPartFills: Record<string, FuturesBookPartFill[]>;
}

export interface FuturesOrderMergeResult {
  /** 合并三阶段成交后的订单列表（全部为不可变赋值） */
  updatedOrders: FuturesOrder[];
  /** 本回合所有真实成交（已按订单合并 first+cross，含 leverage），供持仓落账 */
  allFilledOrders: FuturesFillRecord[];
}

/** 把同一订单的多条成交按成交量加权合并 */
function mergeFillList<T extends { orderId: string; tokenId: string; side: 'open_long' | 'open_short' | 'close_long' | 'close_short'; filledValue: number; filledTokenQty: number; avgPrice: number }>(
  fills: T[],
): Map<string, { orderId: string; tokenId: string; side: 'open_long' | 'open_short' | 'close_long' | 'close_short'; filledValue: number; filledTokenQty: number; avgPrice: number }> {
  const map = new Map<string, { orderId: string; tokenId: string; side: 'open_long' | 'open_short' | 'close_long' | 'close_short'; filledValue: number; filledTokenQty: number; avgPrice: number }>();
  fills.forEach(fill => {
    const existing = map.get(fill.orderId);
    if (existing) {
      const newFilledValue = existing.filledValue + fill.filledValue;
      const newFilledTokenQty = existing.filledTokenQty + fill.filledTokenQty;
      const newAvgPrice = newFilledTokenQty > 0
        ? ((existing.avgPrice * existing.filledTokenQty) + (fill.avgPrice * fill.filledTokenQty)) / newFilledTokenQty
        : fill.avgPrice;
      map.set(fill.orderId, {
        orderId: fill.orderId,
        tokenId: fill.tokenId,
        side: fill.side,
        filledValue: newFilledValue,
        filledTokenQty: newFilledTokenQty,
        avgPrice: newAvgPrice,
      });
    } else {
      map.set(fill.orderId, {
        orderId: fill.orderId,
        tokenId: fill.tokenId,
        side: fill.side,
        filledValue: fill.filledValue,
        filledTokenQty: fill.filledTokenQty,
        avgPrice: fill.avgPrice,
      });
    }
  });
  return map;
}

/**
 * 【Stage3-B3·域二-E1】合约订单三阶段成交合并（纯函数）
 *
 * 输入：回合开始订单 + 限价单撮合结果 + 交叉盘撮合结果 + 盘口生成阶段成交。
 * 输出：合并后的订单状态（不可变赋值）+ 本回合真实成交汇总（供持仓落账）。
 *
 * 逐字搬运原 13072–13288 逻辑：
 *   1. firstPart/cross 各自按 orderId 加权合并；
 *   2. 订单若被第一部分处理过，以其结果为基础（processedOrder 优先）；
 *   3. 交叉盘成交但未被第一部分处理 → 回填订单的 filledQuantity/filledTokenQty/totalCost；
 *   4. 已 completed 的订单只记录「本回合 first+cross」成交；
 *   5. 有第二部分成交时，用「本回合 first+cross+second」的加权成交更新订单与成交汇总；
 *   6. 无第二部分成交时，只记录 first+cross。
 */
export function mergeFuturesOrderFills(input: FuturesOrderMergeInput): FuturesOrderMergeResult {
  const { orders, processedOrders, fills, crossFills, secondPartFills } = input;

  const processedMap = new Map<string, FuturesOrder>();
  processedOrders.forEach(order => processedMap.set(order.id, order));

  const firstPartFillsMap = mergeFillList(fills);
  const crossMatchFillsMap = mergeFillList(crossFills);

  const secondPartFillsMap = new Map<string, { filledQuantity: number; filledTokenQty: number; avgPrice: number }>();
  Object.values(secondPartFills).forEach(group => {
    group.forEach(fill => {
      secondPartFillsMap.set(fill.orderId, {
        filledQuantity: fill.filledQuantity,
        filledTokenQty: fill.filledTokenQty,
        avgPrice: fill.avgPrice,
      });
    });
  });

  const allFilledOrders: FuturesFillRecord[] = [];

  const updatedOrders = orders.map(order => {
    const processedOrder = processedMap.get(order.id);
    const firstPartFill = firstPartFillsMap.get(order.id);
    const crossMatchFill = crossMatchFillsMap.get(order.id);
    const secondPartFill = secondPartFillsMap.get(order.id);

    let baseOrder: FuturesOrder = processedOrder ? processedOrder : order;

    const combinedFirstPartFill = firstPartFill || crossMatchFill ? {
      orderId: order.id,
      tokenId: order.tokenId,
      side: (firstPartFill?.side || crossMatchFill?.side) as 'open_long' | 'open_short' | 'close_long' | 'close_short',
      filledValue: (firstPartFill?.filledValue || 0) + (crossMatchFill?.filledValue || 0),
      filledTokenQty: (firstPartFill?.filledTokenQty || 0) + (crossMatchFill?.filledTokenQty || 0),
      avgPrice: ((firstPartFill?.filledValue || 0) + (crossMatchFill?.filledValue || 0)) > 0
        ? (((firstPartFill?.avgPrice || 0) * (firstPartFill?.filledTokenQty || 0)) +
           ((crossMatchFill?.avgPrice || 0) * (crossMatchFill?.filledTokenQty || 0))) /
          ((firstPartFill?.filledTokenQty || 0) + (crossMatchFill?.filledTokenQty || 0))
        : 0,
    } : null;

    // 交叉盘成交但订单未被第一部分处理 → 回填订单成交量
    if (crossMatchFill && !processedOrder) {
      const newFilledQuantity = baseOrder.filledQuantity + crossMatchFill.filledValue;
      const newFilledTokenQty = (baseOrder.filledTokenQty || 0) + crossMatchFill.filledTokenQty;
      const newTotalCost = (baseOrder.totalCost || 0) + crossMatchFill.filledValue;

      if (newFilledQuantity >= baseOrder.quantity) {
        baseOrder = {
          ...baseOrder,
          filledQuantity: baseOrder.quantity,
          filledTokenQty: newFilledTokenQty,
          totalCost: newTotalCost,
          status: 'filled' as const,
        };
      } else {
        baseOrder = {
          ...baseOrder,
          filledQuantity: newFilledQuantity,
          filledTokenQty: newFilledTokenQty,
          totalCost: newTotalCost,
        };
      }
    }

    if (baseOrder.status === 'filled') {
      if (combinedFirstPartFill && combinedFirstPartFill.filledValue > 0) {
        allFilledOrders.push({
          orderId: baseOrder.id,
          tokenId: baseOrder.tokenId,
          side: combinedFirstPartFill.side,
          filledValue: combinedFirstPartFill.filledValue,
          filledTokenQty: combinedFirstPartFill.filledTokenQty,
          avgPrice: combinedFirstPartFill.avgPrice,
          leverage: baseOrder.leverage || 10,
        });
      }
      return baseOrder;
    }

    if (secondPartFill && secondPartFill.filledQuantity > 0) {
      const newFilledQuantity = baseOrder.filledQuantity + secondPartFill.filledQuantity;
      const newFilledTokenQty = (baseOrder.filledTokenQty || 0) + secondPartFill.filledTokenQty;
      const totalCost = (baseOrder.totalCost || 0) + secondPartFill.filledQuantity;

      const totalFilledValue = (combinedFirstPartFill?.filledValue || 0) + secondPartFill.filledQuantity;
      const totalFilledTokenQty = (combinedFirstPartFill?.filledTokenQty || 0) + secondPartFill.filledTokenQty;
      const totalAvgPrice = totalFilledTokenQty > 0
        ? (((combinedFirstPartFill?.avgPrice || 0) * (combinedFirstPartFill?.filledTokenQty || 0)) +
           (secondPartFill.avgPrice * secondPartFill.filledTokenQty)) / totalFilledTokenQty
        : secondPartFill.avgPrice;

      if (newFilledQuantity >= baseOrder.quantity) {
        allFilledOrders.push({
          orderId: baseOrder.id,
          tokenId: baseOrder.tokenId,
          side: baseOrder.side as 'open_long' | 'open_short',
          filledValue: totalFilledValue,
          filledTokenQty: totalFilledTokenQty,
          avgPrice: totalAvgPrice,
          leverage: baseOrder.leverage || 10,
        });
        return { ...baseOrder, filledQuantity: baseOrder.quantity, filledTokenQty: newFilledTokenQty, totalCost, status: 'filled' as const };
      }

      allFilledOrders.push({
        orderId: baseOrder.id,
        tokenId: baseOrder.tokenId,
        side: baseOrder.side as 'open_long' | 'open_short',
        filledValue: totalFilledValue,
        filledTokenQty: totalFilledTokenQty,
        avgPrice: totalAvgPrice,
        leverage: baseOrder.leverage || 10,
      });
      return {
        ...baseOrder,
        filledQuantity: newFilledQuantity,
        filledTokenQty: newFilledTokenQty,
        totalCost,
      };
    }

    if (combinedFirstPartFill && combinedFirstPartFill.filledValue > 0) {
      allFilledOrders.push({
        orderId: baseOrder.id,
        tokenId: baseOrder.tokenId,
        side: combinedFirstPartFill.side,
        filledValue: combinedFirstPartFill.filledValue,
        filledTokenQty: combinedFirstPartFill.filledTokenQty,
        avgPrice: combinedFirstPartFill.avgPrice,
        leverage: baseOrder.leverage || 10,
      });
    }
    return baseOrder;
  });

  return { updatedOrders, allFilledOrders };
}

export interface FuturesSettlementInput {
  /** 本回合所有成交（mergeFuturesOrderFills().allFilledOrders） */
  fills: FuturesFillRecord[];
  /** 回合开始时的玩家持仓 */
  positions: FuturesPosition[];
  /** 代币列表（用于成交记录里的代码） */
  tokens: { id: string; code?: string }[];
  round: number;
  makeId: () => string;
  /** 回合级随机源（散户杠杆 1–5 倍） */
  rnd: () => number;
  /** 强平价计算（calculateLiquidationPrice 注入，避免循环依赖） */
  liquidationPriceOf: (side: 'long' | 'short', entryPrice: number, leverage: number) => number;
}

export interface FuturesSettlementResult {
  /** 开仓 + 平仓处理后的全新持仓列表（不可变） */
  positions: FuturesPosition[];
  /** 可用资金增量（+返还保证金 +已实现盈亏） */
  availableCapitalDelta: number;
  /** 冻结资金增量（-返还保证金 -开仓成交保证金） */
  frozenCapitalDelta: number;
  /** 开仓成交释放的挂单冻结保证金 */
  openMarginLocked: number;
  openTradeRecords: FuturesTradeRecord[];
  closeTradeRecords: FuturesTradeRecord[];
  /** 成交对手方散户持仓（开仓反向 + 平仓同向，OI 守恒） */
  newRetailPositions: RetailPosition[];
  /** 合并后成交订单数（toast 用） */
  filledOrderCount: number;
  totalPnl: number;
  totalReturnMargin: number;
}

/**
 * 【Stage3-B3·域二-E2】合约成交落账（纯函数）
 *
 * 逐字搬运原 13080–13390：
 *   1. 按 orderId 加权合并成交 → openFills / closeFills；
 *   2. 开仓：同 token+side+杠杆 加仓（重算均价/强平价），否则新建持仓；
 *   3. 平仓：按 token+side+杠杆 找持仓（优先非 pendingClose），按成交比例结算 PnL 与返还保证金，
 *      剩余 ≤0.001 完全平仓，否则部分平仓（value/margin 按比例缩、清 pendingClose）；
 *   4. 资金：可用 += 返还保证金 + PnL；冻结 -= 返还保证金 - 开仓成交保证金；
 *   5. 成交记录：平仓（含 pnl/margin 回填）、开仓各一组；散户对手盘（含平仓单）1–5 倍随机杠杆。
 *
 * 返回完整结构，域三强平引擎可直接复用 positions/资金增量/成交记录。
 */
export function settleFuturesFills(input: FuturesSettlementInput): FuturesSettlementResult {
  const { fills, positions, tokens, round, makeId, rnd, liquidationPriceOf } = input;

  // 1. 按订单合并成交（成交量加权均价；同一订单杠杆一致）
  const fillMap = new Map<string, FuturesFillRecord>();
  fills.forEach(fill => {
    const existing = fillMap.get(fill.orderId);
    if (existing) {
      const newFilledValue = existing.filledValue + fill.filledValue;
      const newFilledTokenQty = existing.filledTokenQty + fill.filledTokenQty;
      const newAvgPrice = newFilledTokenQty > 0
        ? ((existing.avgPrice * existing.filledTokenQty) + (fill.avgPrice * fill.filledTokenQty)) / newFilledTokenQty
        : fill.avgPrice;
      fillMap.set(fill.orderId, {
        orderId: fill.orderId,
        tokenId: fill.tokenId,
        side: fill.side,
        filledValue: newFilledValue,
        filledTokenQty: newFilledTokenQty,
        avgPrice: newAvgPrice,
        leverage: fill.leverage,
      });
    } else {
      fillMap.set(fill.orderId, { ...fill });
    }
  });
  const mergedFills = Array.from(fillMap.values());
  const openFills = mergedFills.filter(f => f.side === 'open_long' || f.side === 'open_short');
  const closeFills = mergedFills.filter(f => f.side === 'close_long' || f.side === 'close_short');

  const tokenCodeOf = (tokenId: string) => tokens.find(t => t.id === tokenId)?.code || '';

  // 2. 开仓：增加持仓
  let positionsAfterOpen: FuturesPosition[] = [...positions];
  if (openFills.length > 0) {
    positionsAfterOpen = [...positions];
    openFills.forEach(fill => {
      if (fill.filledTokenQty <= 0 || fill.filledValue <= 0) return;

      const orderLeverage = fill.leverage || 10;
      const side: 'long' | 'short' = fill.side === 'open_long' ? 'long' : 'short';
      const existingIndex = positionsAfterOpen.findIndex(
        p => p.tokenId === fill.tokenId && p.side === side && p.leverage === orderLeverage,
      );

      if (existingIndex >= 0) {
        const existing = positionsAfterOpen[existingIndex];
        const newQuantity = existing.quantity + fill.filledTokenQty;
        const newValue = existing.value + fill.filledValue;
        const newMargin = existing.margin + (fill.filledValue / orderLeverage);
        const safeQuantity = newQuantity > 0.0001 ? newQuantity : 0.0001;
        const newEntryPrice = newValue / safeQuantity;
        const newLiquidationPrice = liquidationPriceOf(side, newEntryPrice, orderLeverage);

        positionsAfterOpen[existingIndex] = {
          ...existing,
          quantity: newQuantity,
          value: newValue,
          margin: newMargin,
          entryPrice: newEntryPrice,
          liquidationPrice: newLiquidationPrice,
        };
      } else {
        let safeAvgPrice = fill.avgPrice;
        if (!safeAvgPrice || safeAvgPrice <= 0 || !isFinite(safeAvgPrice)) {
          safeAvgPrice = fill.filledTokenQty > 0 ? fill.filledValue / fill.filledTokenQty : 0.0001;
        }
        if (!safeAvgPrice || safeAvgPrice <= 0 || !isFinite(safeAvgPrice)) {
          safeAvgPrice = 0.0001;
        }
        positionsAfterOpen.push({
          id: makeId(),
          tokenId: fill.tokenId,
          side,
          entryPrice: safeAvgPrice > 0 ? safeAvgPrice : 0.0001,
          quantity: fill.filledTokenQty,
          value: fill.filledValue,
          leverage: orderLeverage,
          margin: fill.filledValue / orderLeverage,
          liquidationPrice: liquidationPriceOf(side, safeAvgPrice > 0 ? safeAvgPrice : 0.0001, orderLeverage),
          unrealizedPnl: 0,
          roe: 0,
        });
      }
    });
  }

  // 3. 平仓：减少持仓，结算 PnL 与返还保证金
  let totalPnl = 0;
  let totalReturnMargin = 0;
  const closePnlMap = new Map<string, { pnl: number; returnMargin: number }>();
  let positionsAfterClose: FuturesPosition[] = positionsAfterOpen;

  if (closeFills.length > 0) {
    const prev = positionsAfterOpen;
    const updated: FuturesPosition[] = [];
    const positionsToRemove: string[] = [];

    closeFills.forEach(fill => {
      if (fill.filledTokenQty <= 0 || fill.filledValue <= 0) return;

      const side: 'long' | 'short' = fill.side === 'close_long' ? 'long' : 'short';
      const orderLeverage = fill.leverage || 10;

      const positionIndex = prev.findIndex(
        p => p.tokenId === fill.tokenId && p.side === side && p.leverage === orderLeverage && !p.pendingClose,
      );
      const pendingPositionIndex = positionIndex >= 0 ? positionIndex : prev.findIndex(
        p => p.tokenId === fill.tokenId && p.side === side && p.leverage === orderLeverage,
      );

      if (pendingPositionIndex >= 0) {
        const position = prev[pendingPositionIndex];
        const closeQuantity = Math.min(fill.filledTokenQty, position.quantity);
        const closeValue = closeQuantity * fill.avgPrice;
        const openValue = (position.value || position.quantity * position.entryPrice) * (closeQuantity / position.quantity);

        const pnl = position.side === 'long' ? closeValue - openValue : openValue - closeValue;
        totalPnl += pnl;

        const returnMargin = position.margin * (closeQuantity / position.quantity);
        totalReturnMargin += returnMargin;

        closePnlMap.set(fill.orderId, { pnl, returnMargin });

        const newQuantity = position.quantity - closeQuantity;
        if (newQuantity <= 0.001) {
          positionsToRemove.push(position.id);
        } else {
          const remainingRatio = newQuantity / position.quantity;
          updated.push({
            ...position,
            quantity: newQuantity,
            value: (position.value || position.quantity * position.entryPrice) * remainingRatio,
            margin: position.margin * remainingRatio,
            pendingClose: false,
            closeOrderId: undefined,
          });
        }
      }
    });

    prev.forEach(p => {
      if (!positionsToRemove.includes(p.id) && !updated.find(u => u.id === p.id)) {
        updated.push(p);
      }
    });

    positionsAfterClose = updated;
  }

  // 4. 开仓成交保证金释放（挂单时冻结 → 成交后转为持仓保证金）
  let totalMarginForPosition = 0;
  openFills.forEach(fill => {
    const orderLeverage = fill.leverage || 10;
    totalMarginForPosition += fill.filledValue / orderLeverage;
  });

  // 5. 成交流水
  const closeTradeRecords: FuturesTradeRecord[] = closeFills.map(fill => {
    const pnlInfo = closePnlMap.get(fill.orderId);
    return {
      id: makeId(),
      tokenId: fill.tokenId,
      tokenCode: tokenCodeOf(fill.tokenId),
      orderType: 'limit' as const,
      action: 'close' as const,
      side: fill.side === 'close_long' ? 'long' : 'short',
      price: fill.avgPrice,
      quantity: fill.filledTokenQty,
      value: fill.filledValue,
      pnl: pnlInfo?.pnl,
      margin: pnlInfo?.returnMargin,
      timestamp: round,
    };
  });

  const openTradeRecords: FuturesTradeRecord[] = openFills.map(fill => ({
    id: makeId(),
    tokenId: fill.tokenId,
    tokenCode: tokenCodeOf(fill.tokenId),
    orderType: 'limit' as const,
    action: 'open' as const,
    side: fill.side === 'open_long' ? 'long' : 'short',
    price: fill.avgPrice,
    quantity: fill.filledTokenQty,
    value: fill.filledValue,
    timestamp: round,
  }));

  // 6. 散户对手盘（开仓反向；平仓同向——OI 双向记账）
  const newRetailPositions: RetailPosition[] = [];
  openFills.forEach(fill => {
    if (fill.filledValue > 0) {
      const retailSide: 'long' | 'short' = fill.side === 'open_long' ? 'short' : 'long';
      const retailLeverage = 1 + Math.floor(rnd() * 5);
      const retailMargin = fill.filledValue / retailLeverage;
      newRetailPositions.push({
        id: makeId(),
        tokenId: fill.tokenId,
        side: retailSide,
        entryPrice: fill.avgPrice,
        quantity: fill.filledValue,
        leverage: retailLeverage,
        margin: retailMargin,
        liquidationPrice: liquidationPriceOf(retailSide, fill.avgPrice, retailLeverage),
        createdAt: round,
      });
    }
  });
  closeFills.forEach(fill => {
    if (fill.filledValue > 0) {
      const retailSide: 'long' | 'short' = fill.side === 'close_long' ? 'long' : 'short';
      const retailLeverage = 1 + Math.floor(rnd() * 5);
      const retailMargin = fill.filledValue / retailLeverage;
      newRetailPositions.push({
        id: makeId(),
        tokenId: fill.tokenId,
        side: retailSide,
        entryPrice: fill.avgPrice,
        quantity: fill.filledValue,
        leverage: retailLeverage,
        margin: retailMargin,
        liquidationPrice: liquidationPriceOf(retailSide, fill.avgPrice, retailLeverage),
        createdAt: round,
      });
    }
  });

  return {
    positions: positionsAfterClose,
    availableCapitalDelta: totalReturnMargin + totalPnl,
    frozenCapitalDelta: -totalReturnMargin - totalMarginForPosition,
    openMarginLocked: totalMarginForPosition,
    openTradeRecords,
    closeTradeRecords,
    newRetailPositions,
    filledOrderCount: mergedFills.length,
    totalPnl,
    totalReturnMargin,
  };
}

// ============ 域三-1：预测强平 / ADL 挂单 / K线高低价叠加 ============

/** 预测强平条目（ADL 深度预估用） */
export interface PredictedLiquidation {
  tokenId: string;
  side: 'long' | 'short';
  quantity: number; // 代币数量
  value: number; // 持仓金额
  isPlayer: boolean;
  positionId: string;
  entryPrice: number;
  liquidationPrice?: number;
  pnl: number;
}

/** 按代币聚合的预测强平 */
export interface LiquidationAggregate {
  longQuantity: number;
  shortQuantity: number;
  longValue: number;
  shortValue: number;
  positions: PredictedLiquidation[];
}

export interface PredictedLiquidationInput {
  playerPositions: FuturesPosition[];
  /** 已合并的散户持仓快照（旧散户 + 本轮套利 + 本轮成交对手盘） */
  retailPositions: RetailPosition[];
  books: Record<string, FuturesOrderBook>;
  pnlOf: (pos: FuturesPosition, markPrice: number) => { unrealizedPnl: number };
}

export interface PredictedLiquidationResult {
  predicted: PredictedLiquidation[];
  byToken: Map<string, LiquidationAggregate>;
  retailPositionsByToken: Map<string, RetailPosition[]>;
  playerPositionsByToken: Map<string, FuturesPosition[]>;
}

/**
 * 预测即将强平的玩家/散户持仓，并预分组持仓（纯函数，禁止读 state）。
 * 与原逻辑逐字一致：玩家先、散户后；散户 quantity 为 USDT 名义。
 */
export function computePredictedLiquidations(input: PredictedLiquidationInput): PredictedLiquidationResult {
  const { playerPositions, retailPositions, books, pnlOf } = input;
  const predicted: PredictedLiquidation[] = [];

  const retailPositionsByToken = new Map<string, RetailPosition[]>();
  retailPositions.forEach(pos => {
    const list = retailPositionsByToken.get(pos.tokenId);
    if (list) list.push(pos);
    else retailPositionsByToken.set(pos.tokenId, [pos]);
  });
  const playerPositionsByToken = new Map<string, FuturesPosition[]>();
  playerPositions.forEach(pos => {
    const list = playerPositionsByToken.get(pos.tokenId);
    if (list) list.push(pos);
    else playerPositionsByToken.set(pos.tokenId, [pos]);
  });

  // 玩家持仓：按强平价判定
  playerPositions.forEach(pos => {
    const futuresBook = books[pos.tokenId];
    if (!futuresBook) return;
    const markPrice = futuresBook.markPrice;
    let shouldLiquidate = false;
    if (pos.side === 'long' && markPrice <= pos.liquidationPrice) shouldLiquidate = true;
    else if (pos.side === 'short' && markPrice >= pos.liquidationPrice) shouldLiquidate = true;
    if (!shouldLiquidate) return;
    const { unrealizedPnl } = pnlOf(pos, markPrice);
    predicted.push({
      tokenId: pos.tokenId,
      side: pos.side,
      quantity: pos.quantity,
      value: pos.value || (pos.quantity * pos.entryPrice),
      isPlayer: true,
      positionId: pos.id,
      entryPrice: pos.entryPrice,
      liquidationPrice: pos.liquidationPrice,
      pnl: unrealizedPnl,
    });
  });

  // 散户持仓：quantity 为名义金额，先换算币数
  retailPositions.forEach(pos => {
    const futuresBook = books[pos.tokenId];
    if (!futuresBook) return;
    const markPrice = futuresBook.markPrice;
    let shouldLiquidate = false;
    if (pos.side === 'long' && markPrice <= pos.liquidationPrice) shouldLiquidate = true;
    else if (pos.side === 'short' && markPrice >= pos.liquidationPrice) shouldLiquidate = true;
    if (!shouldLiquidate) return;
    const tokenQty = pos.quantity / pos.entryPrice;
    let pnl = 0;
    if (pos.side === 'long') pnl = (markPrice - pos.entryPrice) * tokenQty;
    else pnl = (pos.entryPrice - markPrice) * tokenQty;
    predicted.push({
      tokenId: pos.tokenId,
      side: pos.side,
      quantity: tokenQty,
      value: pos.quantity,
      isPlayer: false,
      positionId: pos.id,
      entryPrice: pos.entryPrice,
      liquidationPrice: pos.liquidationPrice,
      pnl,
    });
  });

  // 按代币聚合
  const byToken = new Map<string, LiquidationAggregate>();
  predicted.forEach(liq => {
    const existing = byToken.get(liq.tokenId) || {
      longQuantity: 0, shortQuantity: 0, longValue: 0, shortValue: 0,
      positions: [] as PredictedLiquidation[],
    };
    if (liq.side === 'long') {
      existing.longQuantity += liq.quantity;
      existing.longValue += liq.value;
    } else {
      existing.shortQuantity += liq.quantity;
      existing.shortValue += liq.value;
    }
    existing.positions.push(liq);
    byToken.set(liq.tokenId, existing);
  });

  return { predicted, byToken, retailPositionsByToken, playerPositionsByToken };
}

export interface ADLOrderInput {
  liquidationsByToken: Map<string, LiquidationAggregate>;
  books: Record<string, FuturesOrderBook>;
  retailPositionsByToken: Map<string, RetailPosition[]>;
  playerPositionsByToken: Map<string, FuturesPosition[]>;
  aiTraders: AITrader[];
  aiMarketMakers: AIMarketMaker[];
  pnlOf: (pos: FuturesPosition, markPrice: number) => { unrealizedPnl: number };
  tokenCodeOf: (tokenId: string) => string;
}

export interface ADLOrderToast {
  message: string;
  type: 'error';
}

export interface ADLOrderResult {
  /** 只有被修改的代币会出现在这里，且都是**全新** book 对象 */
  books: Record<string, FuturesOrderBook>;
  toasts: ADLOrderToast[];
}

/** 深拷贝合约盘口（ADL 只改 bids/asks，其余字段原样保留） */
function cloneFuturesBook(book: FuturesOrderBook): FuturesOrderBook {
  return {
    ...book,
    bids: book.bids.map(b => ({ ...b })),
    asks: book.asks.map(a => ({ ...a })),
  };
}

/**
 * ADL 深度预估：当强平需求超过盘口深度时，把盈利仓位的平仓单挂进对手盘（纯函数）。
 * 输入盘口不会被修改，返回全新 book 对象；toast 文本按原顺序收集。
 */
export function buildADLOrders(input: ADLOrderInput): ADLOrderResult {
  const { liquidationsByToken, books, retailPositionsByToken, playerPositionsByToken, aiTraders, aiMarketMakers, pnlOf, tokenCodeOf } = input;
  const booksOut: Record<string, FuturesOrderBook> = {};
  const toasts: ADLOrderToast[] = [];

  // ADL盈利仓位结构（带所有者与优先级信息）
  interface ProfitableADLPosition {
    tokenId: string;
    side: 'long' | 'short';
    quantity: number;
    value: number;
    positionId: string;
    entryPrice: number;
    pnl: number;
    ownerType: 'player' | 'retail' | 'ai' | 'mm';
    ownerId?: string;
    priority: number; // ADL优先级：散户0 > AI/做市商1 > 玩家2
  }

for (const [tokenId, liqInfo] of liquidationsByToken) {
  const sourceBook = books[tokenId];
  if (!sourceBook) continue;
    const futuresBook = cloneFuturesBook(sourceBook);

  const markPrice = futuresBook.markPrice;

  // 计算盘口深度
  const bidDepth = futuresBook.bids.reduce((sum, b) => sum + b.quantity, 0);
  const askDepth = futuresBook.asks.reduce((sum, a) => sum + a.quantity, 0);

  // 多头强平需要卖出（吃买盘），空头强平需要买入（吃卖盘）
  const longLiquidationDepthNeeded = liqInfo.longQuantity;
  const shortLiquidationDepthNeeded = liqInfo.shortQuantity;

  // 判断是否需要ADL：强平数量超过盘口深度（修改：从80%改为100%，确保深度完全不足时才触发ADL）
  // 同时，当盘口深度为0时也触发ADL
  const needADLForLong = (longLiquidationDepthNeeded > bidDepth || (longLiquidationDepthNeeded > 0 && bidDepth === 0));
  const needADLForShort = (shortLiquidationDepthNeeded > askDepth || (shortLiquidationDepthNeeded > 0 && askDepth === 0));

  if (needADLForLong || needADLForShort) {
    // 需要触发ADL，收集盈利仓位
    // 【ADL优先级】优先收集散户仓位，其次是做市商仓位与AI交易员仓位，最后才是玩家仓位
    // 优先级：散户(0) > AI交易员/做市商(1) > 玩家(2)

    // 获取买一价和卖一价，用于设置ADL订单价格
    const bestBid = futuresBook.bids.length > 0 ? futuresBook.bids[0].price : markPrice;
    const bestAsk = futuresBook.asks.length > 0 ? futuresBook.asks[0].price : markPrice;

    // ADL盈利仓位结构（带所有者与优先级信息）
    interface ProfitableADLPosition {
      tokenId: string;
      side: 'long' | 'short';
      quantity: number; // 代币数量
      value: number; // 持仓金额
      positionId: string; // 持仓ID（AI/做市商为组合键）
      entryPrice: number;
      pnl: number;
      ownerType: 'player' | 'retail' | 'ai' | 'mm';
      ownerId?: string; // AI交易员/做市商ID
      priority: number; // ADL优先级：散户0 > AI/做市商1 > 玩家2
    }

    // 收集所有多头盈利仓位（用于空头强平时的ADL）
    const profitableLongPositions: ProfitableADLPosition[] = [];
    // 收集所有空头盈利仓位（用于多头强平时的ADL）
    const profitableShortPositions: ProfitableADLPosition[] = [];

    // 检查玩家持仓的盈亏（使用最新状态，按代币分组避免全量遍历）
    const playerTokenPositions = playerPositionsByToken.get(tokenId) || [];
    playerTokenPositions.forEach(pos => {
      if (pos.tokenId !== tokenId) return;
      const { unrealizedPnl } = pnlOf(pos, markPrice);

      if (pos.side === 'long' && unrealizedPnl > 0) {
        profitableLongPositions.push({
          tokenId: pos.tokenId,
          side: 'long',
          quantity: pos.quantity,
          value: pos.value || (pos.quantity * pos.entryPrice),
          positionId: pos.id,
          entryPrice: pos.entryPrice,
          pnl: unrealizedPnl,
          ownerType: 'player',
          priority: 2,
        });
      } else if (pos.side === 'short' && unrealizedPnl > 0) {
        profitableShortPositions.push({
          tokenId: pos.tokenId,
          side: 'short',
          quantity: pos.quantity,
          value: pos.value || (pos.quantity * pos.entryPrice),
          positionId: pos.id,
          entryPrice: pos.entryPrice,
          pnl: unrealizedPnl,
          ownerType: 'player',
          priority: 2,
        });
      }
    });

    // 检查散户持仓的盈亏（使用最新状态，按代币分组避免全量遍历）
    const retailTokenPositions = retailPositionsByToken.get(tokenId) || [];
    retailTokenPositions.forEach(pos => {
      if (pos.tokenId !== tokenId) return;
      const tokenQty = pos.quantity / pos.entryPrice;
      let pnl = 0;
      if (pos.side === 'long') {
        pnl = (markPrice - pos.entryPrice) * tokenQty;
      } else {
        pnl = (pos.entryPrice - markPrice) * tokenQty;
      }

      if (pos.side === 'long' && pnl > 0) {
        profitableLongPositions.push({
          tokenId: pos.tokenId,
          side: 'long',
          quantity: tokenQty,
          value: pos.quantity,
          positionId: pos.id,
          entryPrice: pos.entryPrice,
          pnl,
          ownerType: 'retail',
          priority: 0,
        });
      } else if (pos.side === 'short' && pnl > 0) {
        profitableShortPositions.push({
          tokenId: pos.tokenId,
          side: 'short',
          quantity: tokenQty,
          value: pos.quantity,
          positionId: pos.id,
          entryPrice: pos.entryPrice,
          pnl,
          ownerType: 'retail',
          priority: 0,
        });
      }
    });

    // 检查AI交易员合约持仓的盈亏（使用本回合AI交易后的最新状态）
    aiTraders.forEach(trader => {
      (trader.futuresPositions || []).forEach(pos => {
        if (pos.tokenId !== tokenId) return;
        let pnl = 0;
        if (pos.side === 'long') {
          pnl = (markPrice - pos.entryPrice) * pos.quantity;
        } else {
          pnl = (pos.entryPrice - markPrice) * pos.quantity;
        }
        if (pnl <= 0) return;
        const positionId = `${trader.id}|${pos.tokenId}|${pos.side}`;
        if (pos.side === 'long') {
          profitableLongPositions.push({
            tokenId: pos.tokenId,
            side: 'long',
            quantity: pos.quantity,
            value: pos.quantity * pos.entryPrice,
            positionId,
            entryPrice: pos.entryPrice,
            pnl,
            ownerType: 'ai',
            ownerId: trader.id,
            priority: 1,
          });
        } else {
          profitableShortPositions.push({
            tokenId: pos.tokenId,
            side: 'short',
            quantity: pos.quantity,
            value: pos.quantity * pos.entryPrice,
            positionId,
            entryPrice: pos.entryPrice,
            pnl,
            ownerType: 'ai',
            ownerId: trader.id,
            priority: 1,
          });
        }
      });
    });

    // 检查做市商合约持仓的盈亏（使用本回合AI交易后的最新状态）
    aiMarketMakers.forEach(mm => {
      (mm.futuresPositions || []).forEach(pos => {
        if (pos.tokenId !== tokenId) return;
        let pnl = 0;
        if (pos.side === 'long') {
          pnl = (markPrice - pos.entryPrice) * pos.quantity;
        } else {
          pnl = (pos.entryPrice - markPrice) * pos.quantity;
        }
        if (pnl <= 0) return;
        const positionId = `${mm.id}|${pos.tokenId}|${pos.side}`;
        if (pos.side === 'long') {
          profitableLongPositions.push({
            tokenId: pos.tokenId,
            side: 'long',
            quantity: pos.quantity,
            value: pos.quantity * pos.entryPrice,
            positionId,
            entryPrice: pos.entryPrice,
            pnl,
            ownerType: 'mm',
            ownerId: mm.id,
            priority: 1,
          });
        } else {
          profitableShortPositions.push({
            tokenId: pos.tokenId,
            side: 'short',
            quantity: pos.quantity,
            value: pos.quantity * pos.entryPrice,
            positionId,
            entryPrice: pos.entryPrice,
            pnl,
            ownerType: 'mm',
            ownerId: mm.id,
            priority: 1,
          });
        }
      });
    });

    // 排序：先按ADL优先级（散户 > AI/做市商 > 玩家），同优先级内按盈利从高到低
    profitableLongPositions.sort((a, b) => (a.priority - b.priority) || (b.pnl - a.pnl));
    profitableShortPositions.sort((a, b) => (a.priority - b.priority) || (b.pnl - a.pnl));

    // 多头强平需要ADL空头盈利仓位（空头平仓 = 买入，需要在买盘挂买单供多头强平吃）
    // 修复：空头平仓应该在买盘挂买单（买入），价格略高于买一价，确保被优先吃掉
    if (needADLForLong) {
      // 修复：ADL需要提供足够的深度完全覆盖强平需求，而不是只补充不足的部分
      const adlQuantityNeeded = longLiquidationDepthNeeded; // 目标：提供与强平数量相等的买盘深度
      let adlQuantityProvided = 0;

      for (const pos of profitableShortPositions) {
        if (adlQuantityProvided >= adlQuantityNeeded) break;

        const adlQuantity = Math.min(pos.quantity, adlQuantityNeeded - adlQuantityProvided);
        if (adlQuantity > 0.001) {
          // 空头平仓（买入）被ADL：需要在买盘挂买单，价格略高于买一价
          // 这样多头强平（卖出吃买盘）时，会先吃掉这些ADL买单
          // 买盘按价格降序排列，价格高的在前，所以略高于买一价会被优先吃掉
          // 修复：使用lastPrice作为后备价格，确保ADL订单价格合理
          const basePrice = bestBid > 0 ? bestBid : (futuresBook.lastPrice > 0 ? futuresBook.lastPrice : markPrice);
          // 【修改】ADL买单按被强平多头的强平价格挂单，而不是按当前价格
          // 防止强平仓位亏损至负数，也防止盈利仓位获得多余盈利
          const liquidatedLongPositions = liqInfo.positions.filter(p => p.side === 'long' && (p.liquidationPrice ?? 0) > 0);
          const avgLongLiquidationPrice = liquidatedLongPositions.length > 0
            ? liquidatedLongPositions.reduce((sum, p) => sum + (p.liquidationPrice ?? 0) * p.quantity, 0) / liquidatedLongPositions.reduce((sum, p) => sum + p.quantity, 0)
            : 0;
          const adlPrice = avgLongLiquidationPrice > 0 ? avgLongLiquidationPrice : basePrice * 1.01;
          // 在买盘挂出限价买单（空头平仓 = 买入）
          futuresBook.bids.push({
            price: adlPrice,
            quantity: adlQuantity,
            total: adlPrice * adlQuantity,
            isPlayer: pos.ownerType === 'player',
            isADL: true, // 标记为ADL订单
            adlPositionId: pos.positionId,
            adlSide: 'short', // 标记ADL订单的持仓方向（空头）
            adlOwnerType: pos.ownerType,
            adlOwnerId: pos.ownerId,
          });

          // 记录ADL（部分或全部）
          if (pos.ownerType === 'player') {
            toasts.push({ message: `⚠️ ADL触发: ${tokenCodeOf(tokenId)} 空头仓位被强制挂单平仓`, type: 'error' });
          }

          adlQuantityProvided += adlQuantity;
        }
      }

      // 如果没有盈利仓位或盈利仓位不足，记录警告
      if (adlQuantityProvided < adlQuantityNeeded * 0.5) {
        toasts.push({ message: `⚠️ ${tokenCodeOf(tokenId)} 多头强平盘口深度不足，可能需要多回合完成`, type: 'error' });
      }

      // 重新排序买盘（价格降序）
      futuresBook.bids.sort((a, b) => b.price - a.price);
    }

    // 空头强平需要ADL多头盈利仓位（多头平仓 = 卖出，需要在卖盘挂卖单供空头强平吃）
    // 修复：多头平仓应该在卖盘挂卖单（卖出），价格略低于卖一价，确保被优先吃掉
    if (needADLForShort) {
      // 修复：ADL需要提供足够的深度完全覆盖强平需求，而不是只补充不足的部分
      const adlQuantityNeeded = shortLiquidationDepthNeeded; // 目标：提供与强平数量相等的卖盘深度
      let adlQuantityProvided = 0;

      for (const pos of profitableLongPositions) {
        if (adlQuantityProvided >= adlQuantityNeeded) break;

        const adlQuantity = Math.min(pos.quantity, adlQuantityNeeded - adlQuantityProvided);
        if (adlQuantity > 0.001) {
          // 多头平仓（卖出）被ADL：需要在卖盘挂卖单，价格略低于卖一价
          // 这样空头强平（买入吃卖盘）时，会先吃掉这些ADL卖单
          // 卖盘按价格升序排列，价格低的在前，所以略低于卖一价会被优先吃掉
          // 修复：使用lastPrice作为后备价格，确保ADL订单价格合理
          const basePrice = bestAsk > 0 ? bestAsk : (futuresBook.lastPrice > 0 ? futuresBook.lastPrice : markPrice);
          // 【修改】ADL卖单按被强平空头的强平价格挂单，而不是按当前价格
          // 防止强平仓位亏损至负数，也防止盈利仓位获得多余盈利
          const liquidatedShortPositions = liqInfo.positions.filter(p => p.side === 'short' && (p.liquidationPrice ?? 0) > 0);
          const avgShortLiquidationPrice = liquidatedShortPositions.length > 0
            ? liquidatedShortPositions.reduce((sum, p) => sum + (p.liquidationPrice ?? 0) * p.quantity, 0) / liquidatedShortPositions.reduce((sum, p) => sum + p.quantity, 0)
            : 0;
          const adlPrice = avgShortLiquidationPrice > 0 ? avgShortLiquidationPrice : basePrice * 0.99;
          // 在卖盘挂出限价卖单（多头平仓 = 卖出）
          futuresBook.asks.push({
            price: adlPrice,
            quantity: adlQuantity,
            total: adlPrice * adlQuantity,
            isPlayer: pos.ownerType === 'player',
            isADL: true, // 标记为ADL订单
            adlPositionId: pos.positionId,
            adlSide: 'long', // 标记ADL订单的持仓方向（多头）
            adlOwnerType: pos.ownerType,
            adlOwnerId: pos.ownerId,
          });

          // 记录ADL
          if (pos.ownerType === 'player') {
            toasts.push({ message: `⚠️ ADL触发: ${tokenCodeOf(tokenId)} 多头仓位被强制挂单平仓`, type: 'error' });
          }

          adlQuantityProvided += adlQuantity;
        }
      }

      // 如果没有盈利仓位或盈利仓位不足，记录警告
      if (adlQuantityProvided < adlQuantityNeeded * 0.5) {
        toasts.push({ message: `⚠️ ${tokenCodeOf(tokenId)} 空头强平盘口深度不足，可能需要多回合完成`, type: 'error' });
      }

      // 重新排序卖盘（价格升序）
      futuresBook.asks.sort((a, b) => a.price - b.price);
    }

    // 更新盘口总量
    futuresBook.totalBidQuantity = futuresBook.bids.reduce((sum, b) => sum + b.quantity, 0);
    futuresBook.totalAskQuantity = futuresBook.asks.reduce((sum, a) => sum + a.quantity, 0);
  }
    booksOut[tokenId] = futuresBook;
  }
  return { books: booksOut, toasts };
}

export interface LiquidationCandleBoostInput {
  amountsByToken: Record<string, { shortAmount: number; longAmount: number }>;
  candlesMap: Record<string, Candle[]>;
  tokens: { id: string; circulatingSupply: number }[];
}

/**
 * 强平金额 → K 线高低价浮动（纯函数）。
 * 空头强平推高 high（≤25%），多头强平压低 low（≤20%），分母 = 市值×20。
 */
export function computeLiquidationCandleBoosts(input: LiquidationCandleBoostInput): Record<string, { highBoost: number; lowDrop: number }> {
  const { amountsByToken, candlesMap, tokens } = input;
  const boosts: Record<string, { highBoost: number; lowDrop: number }> = {};
  Object.keys(amountsByToken).forEach(tokenId => {
    const candleData = candlesMap[tokenId];
    if (!candleData || candleData.length === 0) return;
    const lastCandle = candleData[candleData.length - 1];
    const token = tokens.find(t => t.id === tokenId);
    if (!token || !lastCandle) return;
    const { shortAmount, longAmount } = amountsByToken[tokenId];
    const marketCap = token.circulatingSupply * lastCandle.close;
    let highBoost = 0;
    let lowDrop = 0;
    if (shortAmount > 0 && marketCap > 0) highBoost = Math.min(shortAmount / (marketCap * 20), 0.25);
    if (longAmount > 0 && marketCap > 0) lowDrop = Math.min(longAmount / (marketCap * 20), 0.20);
    if (highBoost > 0 || lowDrop > 0) boosts[tokenId] = { highBoost, lowDrop };
  });
  return boosts;
}

// ============================================================================
// 域三-2：散户强制平仓（市价吃单 / ADL 成交 / 玩家挂单成交 / 对手散户仓）
//
// 红线：
//   1. 不读取 React 闭包，全部输入显式传入。
//   2. 盘口与散户持仓一律返回全新对象/数组，绝不原地 push / splice。
//   3. rnd() 调用顺序与旧实现完全一致（吃单对手散户仓 → 玩家成交对手散户仓）。
// ============================================================================

/** 散户强平输入（App 侧显式传入，保持原有快照语义） */
export interface RetailLiquidationInput {
  /** 本回合最新散户持仓（套利 + 成交生成后），按 token 分组 */
  retailPositionsByToken: Map<string, RetailPosition[]>;
  /** 代币字典（缺失时该组持仓按旧逻辑直接丢弃） */
  tokensById: Map<string, Token>;
  /** 当前盘口快照（只读，受影响盘口返回克隆） */
  books: Record<string, FuturesOrderBook>;
  /** 回合开始时的散户持仓闭包快照（ADL 结算基准） */
  retailPositions: RetailPosition[];
  /** 回合开始时的玩家持仓闭包快照（ADL 结算基准 + 全仓保证金池） */
  playerPositions: FuturesPosition[];
  /** 玩家合约挂单（取杠杆/保证金模式） */
  futuresOrders: FuturesOrder[];
  aiTraders: AITrader[];
  aiMarketMakers: AIMarketMaker[];
  availableCapital: number;
  frozenCapital: number;
  round: number;
  makeId: () => string;
  rnd: () => number;
  /** 套利吃单/成交落账新增的散户持仓（无强平时用于重建列表） */
  arbitrageRetailPositions: RetailPosition[];
  newRetailPositionsFromFills: RetailPosition[];
}

/** ADL 成交记录（原始，按持仓合并前） */
export interface AdlFillRecord {
  positionId: string;
  isPlayer: boolean;
  ownerType: 'player' | 'retail' | 'ai' | 'mm';
  ownerId?: string;
  side: 'long' | 'short';
  filledQty: number;
  filledValue: number;
}

/** 散户强平吃掉玩家挂单的成交记录（按订单合并前） */
export interface RetailLimitFillRecord {
  orderId: string;
  tokenId: string;
  side: 'open_long' | 'open_short';
  filledQty: number;
  filledValue: number;
  price: number;
}

/** 散户持仓 ADL 更新 */
export interface AdlRetailPositionUpdate {
  positionId: string;
  /** 新的名义金额（USDT） */
  quantity: number;
  removed: boolean;
}

/** 玩家持仓 ADL 更新 */
export interface AdlPlayerPositionUpdate {
  positionId: string;
  quantity: number;
  value: number;
  margin: number;
  removed: boolean;
}

/** AI / 做市商持仓 ADL 更新 */
export interface AdlOwnerPositionUpdate {
  ownerType: 'ai' | 'mm';
  ownerId: string;
  tokenId: string;
  side: 'long' | 'short';
  quantity: number;
  returnMargin: number;
  pnl: number;
  removed: boolean;
}

/** 玩家挂单成交（按订单合并后） */
export interface MergedOrderFill {
  orderId: string;
  totalQty: number;
  totalValue: number;
  avgPrice: number;
}

/** 玩家开仓成交（已带杠杆/保证金模式，供应用层合并持仓） */
export interface PlayerOpenFill {
  orderId: string;
  tokenId: string;
  side: 'open_long' | 'open_short';
  totalQty: number;
  totalValue: number;
  avgPrice: number;
  leverage: number;
  marginMode: 'isolated' | 'cross';
}

export interface RetailLiquidationResult {
  /** 受影响的盘口克隆（App 侧回写本地快照与 state） */
  books: Record<string, FuturesOrderBook>;
  liquidationAmountsByToken: Record<string, { shortAmount: number; longAmount: number }>;
  liquidatedPositionIds: string[];
  hasLiquidations: boolean;
  /** 无强平时重建的散户持仓（旧逻辑：updatedRetailPositions + 新生持仓去重） */
  retailRebuildFromGroups: RetailPosition[];
  adlFillCount: number;
  adlPlayerPositionUpdates: AdlPlayerPositionUpdate[];
  adlRetailPositionUpdates: AdlRetailPositionUpdate[];
  adlAiPositionUpdates: AdlOwnerPositionUpdate[];
  adlTradeRecords: FuturesTradeRecord[];
  adlReturnMargin: number;
  adlPnl: number;
  mergedOrderFills: MergedOrderFill[];
  playerOpenFills: PlayerOpenFill[];
  playerOpenMarginTotal: number;
  playerOpenTradeRecords: FuturesTradeRecord[];
  /** 强平吃单/玩家成交生成的对手散户仓 */
  newRetailPositionsFromLiquidation: RetailPosition[];
  crossMarginPool: number;
}

/**
 * 散户强制平仓：整组检查 → 市价吃单 → ADL/玩家成交记录 → 对手散户仓。
 * 只做计算，返回新盘口与落地数据；setState / showToast 由 App 侧按原顺序执行。
 */
export function matchRetailLiquidations(input: RetailLiquidationInput): RetailLiquidationResult {
  const {
    retailPositionsByToken,
    tokensById,
    books,
    retailPositions,
    playerPositions,
    futuresOrders,
    aiTraders,
    aiMarketMakers,
    availableCapital,
    frozenCapital,
    round,
    makeId,
    rnd,
    arbitrageRetailPositions,
    newRetailPositionsFromFills,
  } = input;

  // 盘口惰性克隆：只有真正被吃单/挂单的 token 才返回新对象
  const touchedBooks: Record<string, FuturesOrderBook> = {};
  const touchedBookIds = new Set<string>();
  const getMutableBook = (tokenId: string): FuturesOrderBook | undefined => {
    if (!touchedBookIds.has(tokenId)) {
      const source = books[tokenId];
      if (!source) return undefined;
      touchedBooks[tokenId] = cloneFuturesBook(source);
      touchedBookIds.add(tokenId);
    }
    return touchedBooks[tokenId];
  };

  const liquidationAmountsByToken: Record<string, { shortAmount: number; longAmount: number }> = {};
  const allLiquidatedPositions: RetailPosition[] = [];
  const updatedRetailPositions: RetailPosition[] = [];

  retailPositionsByToken.forEach((group, tokenId) => {
    const token = tokensById.get(tokenId);
    if (!token) return; // 与旧逻辑一致：找不到代币的持仓直接丢弃
    const futuresBook = books[tokenId];
    if (futuresBook) {
      const { liquidatedPositions, remainingPositions } = checkRetailLiquidation(group, futuresBook.markPrice);
      allLiquidatedPositions.push(...liquidatedPositions);
      updatedRetailPositions.push(...remainingPositions);
    } else {
      updatedRetailPositions.push(...group);
    }
  });

  const newRetailPositionsFromLiquidation: RetailPosition[] = [];
  const adlFills: AdlFillRecord[] = [];
  const playerLimitOrderFills: RetailLimitFillRecord[] = [];

  allLiquidatedPositions.forEach(pos => {
    const futuresBook = getMutableBook(pos.tokenId);
    if (!futuresBook) return;

    const positionValue = pos.quantity; // 散户持仓的 quantity 已经是金额
    if (!liquidationAmountsByToken[pos.tokenId]) {
      liquidationAmountsByToken[pos.tokenId] = { shortAmount: 0, longAmount: 0 };
    }
    if (pos.side === 'short') {
      liquidationAmountsByToken[pos.tokenId].shortAmount += positionValue;
    } else {
      liquidationAmountsByToken[pos.tokenId].longAmount += positionValue;
    }

    const tokenQty = pos.quantity / pos.entryPrice;
    let remainingQty = tokenQty;

    if (pos.side === 'long') {
      for (let i = 0; i < futuresBook.bids.length && remainingQty > 0.001; i++) {
        const bid = futuresBook.bids[i];
        const fillQty = Math.min(remainingQty, bid.quantity);
        if (fillQty > 0.001) {
          remainingQty -= fillQty;
          bid.quantity -= fillQty;
          bid.total = bid.price * bid.quantity;

          if (bid.isADL && bid.adlPositionId) {
            adlFills.push({
              positionId: bid.adlPositionId,
              isPlayer: bid.isPlayer || false,
              ownerType: bid.adlOwnerType || (bid.isPlayer ? 'player' : 'retail'),
              ownerId: bid.adlOwnerId,
              side: bid.adlSide || 'long',
              filledQty: fillQty,
              filledValue: fillQty * bid.price,
            });
          } else if (bid.isPlayer) {
            playerLimitOrderFills.push({
              orderId: bid.orderId || '',
              tokenId: pos.tokenId,
              side: 'open_long',
              filledQty: fillQty,
              filledValue: fillQty * bid.price,
              price: bid.price,
            });
          } else {
            const fillValue = fillQty * bid.price;
            const retailLeverage = 1 + Math.floor(rnd() * 5);
            const retailMargin = fillValue / retailLeverage;
            const retailLiquidationPrice = calculateLiquidationPrice('long', bid.price, retailLeverage);
            newRetailPositionsFromLiquidation.push({
              id: makeId(),
              tokenId: pos.tokenId,
              side: 'long',
              entryPrice: bid.price,
              quantity: fillValue,
              leverage: retailLeverage,
              margin: retailMargin,
              liquidationPrice: retailLiquidationPrice,
              createdAt: round,
            });
          }
        }
      }
      futuresBook.bids = futuresBook.bids.filter(b => b.quantity > 0.001);

      if (remainingQty > 0.001) {
        const bestAsk = futuresBook.asks.length > 0 ? futuresBook.asks[0].price : (futuresBook.lastPrice > 0 ? futuresBook.lastPrice : futuresBook.markPrice);
        const liquidationPrice = bestAsk * 0.99;
        futuresBook.asks.push({
          price: liquidationPrice,
          quantity: remainingQty,
          total: liquidationPrice * remainingQty,
          isPlayer: false,
        });
        futuresBook.asks.sort((a, b) => a.price - b.price);
      }
    } else {
      for (let i = 0; i < futuresBook.asks.length && remainingQty > 0.001; i++) {
        const ask = futuresBook.asks[i];
        const fillQty = Math.min(remainingQty, ask.quantity);
        if (fillQty > 0.001) {
          remainingQty -= fillQty;
          ask.quantity -= fillQty;
          ask.total = ask.price * ask.quantity;

          if (ask.isADL && ask.adlPositionId) {
            adlFills.push({
              positionId: ask.adlPositionId,
              isPlayer: ask.isPlayer || false,
              ownerType: ask.adlOwnerType || (ask.isPlayer ? 'player' : 'retail'),
              ownerId: ask.adlOwnerId,
              side: ask.adlSide || 'short',
              filledQty: fillQty,
              filledValue: fillQty * ask.price,
            });
          } else if (ask.isPlayer) {
            playerLimitOrderFills.push({
              orderId: ask.orderId || '',
              tokenId: pos.tokenId,
              side: 'open_short',
              filledQty: fillQty,
              filledValue: fillQty * ask.price,
              price: ask.price,
            });
          } else {
            const fillValue = fillQty * ask.price;
            const retailLeverage = 1 + Math.floor(rnd() * 5);
            const retailMargin = fillValue / retailLeverage;
            const retailLiquidationPrice = calculateLiquidationPrice('short', ask.price, retailLeverage);
            newRetailPositionsFromLiquidation.push({
              id: makeId(),
              tokenId: pos.tokenId,
              side: 'short',
              entryPrice: ask.price,
              quantity: fillValue,
              leverage: retailLeverage,
              margin: retailMargin,
              liquidationPrice: retailLiquidationPrice,
              createdAt: round,
            });
          }
        }
      }
      futuresBook.asks = futuresBook.asks.filter(a => a.quantity > 0.001);

      if (remainingQty > 0.001) {
        const bestBid = futuresBook.bids.length > 0 ? futuresBook.bids[0].price : (futuresBook.lastPrice > 0 ? futuresBook.lastPrice : futuresBook.markPrice);
        const liquidationPrice = bestBid * 1.01;
        futuresBook.bids.push({
          price: liquidationPrice,
          quantity: remainingQty,
          total: liquidationPrice * remainingQty,
          isPlayer: false,
        });
        futuresBook.bids.sort((a, b) => b.price - a.price);
      }
    }

    futuresBook.totalBidQuantity = futuresBook.bids.reduce((sum, b) => sum + b.quantity, 0);
    futuresBook.totalAskQuantity = futuresBook.asks.reduce((sum, a) => sum + a.quantity, 0);
  });

  // ---- ADL 成交结算 ----
  const adlPlayerPositionUpdates: AdlPlayerPositionUpdate[] = [];
  const adlRetailPositionUpdates: AdlRetailPositionUpdate[] = [];
  const adlAiPositionUpdates: AdlOwnerPositionUpdate[] = [];
  const adlTradeRecords: FuturesTradeRecord[] = [];
  let adlReturnMargin = 0;
  let adlPnl = 0;

  if (adlFills.length > 0) {
    const adlFillsByPosition = new Map<string, {
      isPlayer: boolean;
      ownerType: 'player' | 'retail' | 'ai' | 'mm';
      ownerId?: string;
      side: 'long' | 'short';
      totalQty: number;
      totalValue: number;
    }>();
    adlFills.forEach(fill => {
      const existing = adlFillsByPosition.get(fill.positionId);
      if (existing) {
        existing.totalQty += fill.filledQty;
        existing.totalValue += fill.filledValue;
      } else {
        adlFillsByPosition.set(fill.positionId, {
          isPlayer: fill.isPlayer,
          ownerType: fill.ownerType,
          ownerId: fill.ownerId,
          side: fill.side,
          totalQty: fill.filledQty,
          totalValue: fill.filledValue,
        });
      }
    });

    // 玩家持仓
    playerPositions.forEach(pos => {
      const fill = adlFillsByPosition.get(pos.id);
      if (!fill || fill.ownerType !== 'player' || pos.side !== fill.side) return;
      const newQty = pos.quantity - fill.totalQty;
      const avgFillPrice = fill.totalValue / fill.totalQty;
      const token = tokensById.get(pos.tokenId);
      if (newQty > 0.001) {
        const ratio = newQty / pos.quantity;
        const returnMargin = pos.margin * (1 - ratio);
        adlReturnMargin += returnMargin;
        const pnl = pos.side === 'long'
          ? fill.totalValue - (fill.totalQty * pos.entryPrice)
          : (fill.totalQty * pos.entryPrice) - fill.totalValue;
        adlPnl += pnl;
        adlTradeRecords.push({
          id: makeId(),
          tokenId: pos.tokenId,
          tokenCode: token?.code || '',
          orderType: 'limit',
          action: 'adl',
          side: pos.side,
          price: avgFillPrice,
          quantity: fill.totalQty,
          value: fill.totalValue,
          pnl,
          margin: returnMargin,
          timestamp: round,
        });
        adlPlayerPositionUpdates.push({
          positionId: pos.id,
          quantity: newQty,
          value: (pos.value || (pos.quantity * pos.entryPrice)) * ratio,
          margin: pos.margin * ratio,
          removed: false,
        });
      } else {
        adlReturnMargin += pos.margin;
        const pnl = pos.side === 'long'
          ? fill.totalValue - (pos.quantity * pos.entryPrice)
          : (pos.quantity * pos.entryPrice) - fill.totalValue;
        adlPnl += pnl;
        adlTradeRecords.push({
          id: makeId(),
          tokenId: pos.tokenId,
          tokenCode: token?.code || '',
          orderType: 'limit',
          action: 'adl',
          side: pos.side,
          price: avgFillPrice,
          quantity: pos.quantity,
          value: fill.totalValue,
          pnl,
          margin: pos.margin,
          timestamp: round,
        });
        adlPlayerPositionUpdates.push({
          positionId: pos.id,
          quantity: 0,
          value: 0,
          margin: 0,
          removed: true,
        });
      }
    });

    // 散户持仓
    retailPositions.forEach(pos => {
      const fill = adlFillsByPosition.get(pos.id);
      if (!fill || fill.ownerType !== 'retail' || pos.side !== fill.side) return;
      const tokenQty = pos.quantity / pos.entryPrice;
      const newQty = tokenQty - fill.totalQty;
      if (newQty > 0.001) {
        adlRetailPositionUpdates.push({ positionId: pos.id, quantity: newQty * pos.entryPrice, removed: false });
      } else {
        adlRetailPositionUpdates.push({ positionId: pos.id, quantity: 0, removed: true });
      }
    });

    // AI 交易员
    aiTraders.forEach(trader => {
      (trader.futuresPositions || []).forEach(pos => {
        const key = `${trader.id}|${pos.tokenId}|${pos.side}`;
        const fill = adlFillsByPosition.get(key);
        if (!fill || fill.ownerType !== 'ai' || pos.side !== fill.side) return;
        const newQty = pos.quantity - fill.totalQty;
        const ratio = newQty > 0.001 ? newQty / pos.quantity : 0;
        const pnl = pos.side === 'long'
          ? fill.totalValue - (fill.totalQty * pos.entryPrice)
          : (fill.totalQty * pos.entryPrice) - fill.totalValue;
        adlAiPositionUpdates.push({
          ownerType: 'ai',
          ownerId: trader.id,
          tokenId: pos.tokenId,
          side: pos.side,
          quantity: ratio > 0 ? newQty : 0,
          returnMargin: pos.margin * (1 - ratio),
          pnl,
          removed: ratio <= 0,
        });
      });
    });

    // 做市商
    aiMarketMakers.forEach(mm => {
      (mm.futuresPositions || []).forEach(pos => {
        const key = `${mm.id}|${pos.tokenId}|${pos.side}`;
        const fill = adlFillsByPosition.get(key);
        if (!fill || fill.ownerType !== 'mm' || pos.side !== fill.side) return;
        const newQty = pos.quantity - fill.totalQty;
        const ratio = newQty > 0.001 ? newQty / pos.quantity : 0;
        const pnl = pos.side === 'long'
          ? fill.totalValue - (fill.totalQty * pos.entryPrice)
          : (fill.totalQty * pos.entryPrice) - fill.totalValue;
        adlAiPositionUpdates.push({
          ownerType: 'mm',
          ownerId: mm.id,
          tokenId: pos.tokenId,
          side: pos.side,
          quantity: ratio > 0 ? newQty : 0,
          returnMargin: pos.margin * (1 - ratio),
          pnl,
          removed: ratio <= 0,
        });
      });
    });
  }

  // ---- 散户强平吃掉玩家挂单：按订单合并成交 ----
  const mergedOrderFills: MergedOrderFill[] = [];
  const playerOpenFills: PlayerOpenFill[] = [];
  const playerOpenTradeRecords: FuturesTradeRecord[] = [];
  let playerOpenMarginTotal = 0;
  let crossMarginPool = 0;

  if (playerLimitOrderFills.length > 0) {
    const fillsByOrder = new Map<string, { tokenId: string; side: 'open_long' | 'open_short'; totalQty: number; totalValue: number; avgPrice: number }>();
    playerLimitOrderFills.forEach(fill => {
      const existing = fillsByOrder.get(fill.orderId);
      if (existing) {
        const newTotalQty = existing.totalQty + fill.filledQty;
        const newTotalValue = existing.totalValue + fill.filledValue;
        fillsByOrder.set(fill.orderId, {
          tokenId: fill.tokenId,
          side: fill.side,
          totalQty: newTotalQty,
          totalValue: newTotalValue,
          avgPrice: newTotalValue / newTotalQty,
        });
      } else {
        fillsByOrder.set(fill.orderId, {
          tokenId: fill.tokenId,
          side: fill.side,
          totalQty: fill.filledQty,
          totalValue: fill.filledValue,
          avgPrice: fill.filledValue / fill.filledQty,
        });
      }
    });

    fillsByOrder.forEach((fill, orderId) => {
      mergedOrderFills.push({ orderId, totalQty: fill.totalQty, totalValue: fill.totalValue, avgPrice: fill.avgPrice });
    });

    const futuresOrdersById = new Map(futuresOrders.map(o => [o.id, o]));
    fillsByOrder.forEach((fill, orderId) => {
      if (fill.side !== 'open_long' && fill.side !== 'open_short') return;
      const order = futuresOrdersById.get(orderId);
      playerOpenFills.push({
        orderId,
        tokenId: fill.tokenId,
        side: fill.side,
        totalQty: fill.totalQty,
        totalValue: fill.totalValue,
        avgPrice: fill.avgPrice,
        leverage: order?.leverage || 10,
        marginMode: order?.marginMode || 'cross',
      });
    });

    if (playerOpenFills.length > 0) {
      // 全仓保证金池（近似）：当前可用 + 冻结 + 已有持仓正浮盈
      const existingPositivePnl = playerPositions.reduce((sum, p) => {
        const pBook = books[p.tokenId];
        if (!pBook) return sum;
        const { unrealizedPnl } = calculateFuturesPnl(p, pBook.markPrice);
        return sum + Math.max(0, unrealizedPnl);
      }, 0);
      crossMarginPool = availableCapital + frozenCapital + existingPositivePnl;

      playerOpenFills.forEach(fill => {
        if (fill.totalValue > 0) {
          playerOpenMarginTotal += fill.totalValue / (fill.leverage || 10);
        }
        const token = tokensById.get(fill.tokenId);
        playerOpenTradeRecords.push({
          id: makeId(),
          tokenId: fill.tokenId,
          tokenCode: token?.code || '',
          orderType: 'limit',
          action: 'open',
          side: fill.side === 'open_long' ? 'long' : 'short',
          price: fill.avgPrice,
          quantity: fill.totalQty,
          value: fill.totalValue,
          timestamp: round,
        });
      });

      // 玩家成交的对手散户仓（rnd 顺序必须放在所有吃单之后、且在 trade records 之后）
      playerOpenFills.forEach(fill => {
        if (fill.totalValue > 0) {
          const retailSide = fill.side === 'open_long' ? 'short' : 'long';
          const retailLeverage = 1 + Math.floor(rnd() * 5);
          const retailMargin = fill.totalValue / retailLeverage;
          const retailLiquidationPrice = calculateLiquidationPrice(retailSide, fill.avgPrice, retailLeverage);
          newRetailPositionsFromLiquidation.push({
            id: makeId(),
            tokenId: fill.tokenId,
            side: retailSide,
            entryPrice: fill.avgPrice,
            quantity: fill.totalValue,
            leverage: retailLeverage,
            margin: retailMargin,
            liquidationPrice: retailLiquidationPrice,
            createdAt: round,
          });
        }
      });
    }
  }

  // 无强平时重建散户列表：按 token 分组后的剩余 + 本回合新生持仓去重
  const existingIds = new Set(updatedRetailPositions.map(p => p.id));
  const retailRebuildFromGroups = [
    ...updatedRetailPositions,
    ...[...arbitrageRetailPositions, ...newRetailPositionsFromFills].filter(p => !existingIds.has(p.id)),
  ];

  return {
    books: touchedBooks,
    liquidationAmountsByToken,
    liquidatedPositionIds: allLiquidatedPositions.map(p => p.id),
    hasLiquidations: allLiquidatedPositions.length > 0,
    retailRebuildFromGroups,
    adlFillCount: adlFills.length,
    adlPlayerPositionUpdates,
    adlRetailPositionUpdates,
    adlAiPositionUpdates,
    adlTradeRecords,
    adlReturnMargin,
    adlPnl,
    mergedOrderFills,
    playerOpenFills,
    playerOpenMarginTotal,
    playerOpenTradeRecords,
    newRetailPositionsFromLiquidation,
    crossMarginPool,
  };
}

/** 应用 ADL 玩家持仓更新（纯函数：返回全新数组） */
export function applyAdlPlayerPositionUpdates(
  positions: FuturesPosition[],
  updates: AdlPlayerPositionUpdate[],
): FuturesPosition[] {
  if (updates.length === 0) return positions;
  const updateMap = new Map(updates.map(u => [u.positionId, u]));
  const next: FuturesPosition[] = [];
  positions.forEach(pos => {
    const update = updateMap.get(pos.id);
    if (!update) {
      next.push(pos);
    } else if (!update.removed) {
      next.push({ ...pos, quantity: update.quantity, value: update.value, margin: update.margin });
    }
  });
  return next;
}

/** 应用 ADL 散户持仓更新（纯函数：返回全新数组） */
export function applyAdlRetailPositionUpdates(
  positions: RetailPosition[],
  updates: AdlRetailPositionUpdate[],
): RetailPosition[] {
  if (updates.length === 0) return positions;
  const updateMap = new Map(updates.map(u => [u.positionId, u]));
  const next: RetailPosition[] = [];
  positions.forEach(pos => {
    const update = updateMap.get(pos.id);
    if (!update) {
      next.push(pos);
    } else if (!update.removed) {
      next.push({ ...pos, quantity: update.quantity });
    }
  });
  return next;
}

/** 应用 AI 交易员 ADL 结算（纯函数：返回全新数组） */
export function applyAdlAiCapitalUpdates(traders: AITrader[], updates: AdlOwnerPositionUpdate[]): AITrader[] {
  const aiUpdates = updates.filter(u => u.ownerType === 'ai');
  if (aiUpdates.length === 0) return traders;
  return traders.map(trader => {
    const list = aiUpdates.filter(u => u.ownerId === trader.id);
    if (list.length === 0) return trader;
    let capitalAdd = 0;
    let futuresPositions = [...(trader.futuresPositions || [])];
    list.forEach(u => {
      capitalAdd += u.returnMargin + u.pnl;
      if (u.removed) {
        futuresPositions = futuresPositions.filter(p => !(p.tokenId === u.tokenId && p.side === u.side));
      } else {
        futuresPositions = futuresPositions.map(p =>
          p.tokenId === u.tokenId && p.side === u.side
            ? { ...p, quantity: u.quantity, margin: Math.max(0, p.margin - u.returnMargin) }
            : p,
        );
      }
    });
    return { ...trader, futuresPositions, availableCapital: trader.availableCapital + capitalAdd };
  });
}

/** 应用做市商 ADL 结算（纯函数：返回全新数组） */
export function applyAdlMarketMakerCapitalUpdates(marketMakers: AIMarketMaker[], updates: AdlOwnerPositionUpdate[]): AIMarketMaker[] {
  const mmUpdates = updates.filter(u => u.ownerType === 'mm');
  if (mmUpdates.length === 0) return marketMakers;
  return marketMakers.map(mm => {
    const list = mmUpdates.filter(u => u.ownerId === mm.id);
    if (list.length === 0) return mm;
    let capitalAdd = 0;
    let futuresPositions = [...(mm.futuresPositions || [])];
    list.forEach(u => {
      capitalAdd += u.returnMargin + u.pnl;
      if (u.removed) {
        futuresPositions = futuresPositions.filter(p => !(p.tokenId === u.tokenId && p.side === u.side));
      } else {
        futuresPositions = futuresPositions.map(p =>
          p.tokenId === u.tokenId && p.side === u.side
            ? { ...p, quantity: u.quantity, margin: Math.max(0, p.margin - u.returnMargin) }
            : p,
        );
      }
    });
    return { ...mm, futuresPositions, availableCapital: mm.availableCapital + capitalAdd };
  });
}

/** 应用玩家挂单成交（纯函数：返回全新订单数组） */
export function applyPlayerOrderFillUpdates(orders: FuturesOrder[], fills: MergedOrderFill[]): FuturesOrder[] {
  if (fills.length === 0) return orders;
  const fillMap = new Map(fills.map(f => [f.orderId, f]));
  const next: FuturesOrder[] = [];
  orders.forEach(order => {
    const fill = fillMap.get(order.id);
    if (!fill) {
      next.push(order);
      return;
    }
    const newFilledQuantity = (order.filledQuantity || 0) + fill.totalValue;
    const newFilledTokenQty = (order.filledTokenQty || 0) + fill.totalQty;
    const newTotalCost = (order.totalCost || 0) + fill.totalValue;
    // 完全成交的订单不再保留（与旧逻辑一致）
    if (newFilledQuantity < order.quantity - 0.01) {
      next.push({
        ...order,
        filledQuantity: newFilledQuantity,
        filledTokenQty: newFilledTokenQty,
        totalCost: newTotalCost,
        status: 'pending',
      });
    }
  });
  return next;
}

export interface PlayerOpenFillOptions {
  crossMarginPool: number;
  makeId: () => string;
}

/**
 * 把玩家开仓成交合并进持仓列表（纯函数：返回全新数组）。
 * 与旧实现一致：全仓同代币同方向合并、逐仓同方向同杠杆合并。
 */
export function applyPlayerOpenFillsToPositions(
  positions: FuturesPosition[],
  fills: PlayerOpenFill[],
  options: PlayerOpenFillOptions,
): FuturesPosition[] {
  if (fills.length === 0) return positions;
  const updated = [...positions];
  fills.forEach(fill => {
    const orderLeverage = fill.leverage || 10;
    const orderMarginMode = fill.marginMode || 'cross';
    const side = fill.side === 'open_long' ? 'long' : 'short';
    if (fill.totalQty <= 0 || fill.totalValue <= 0) return;

    const existingIndex = updated.findIndex(
      p => p.tokenId === fill.tokenId && p.side === side
        && (orderMarginMode === 'cross' ? (p.marginMode || 'cross') === 'cross' : p.leverage === orderLeverage),
    );

    if (existingIndex >= 0) {
      const existing = updated[existingIndex];
      const newQuantity = existing.quantity + fill.totalQty;
      const newValue = existing.value + fill.totalValue;
      const newMargin = existing.margin + (fill.totalValue / orderLeverage);
      const safeQuantity = newQuantity > 0.0001 ? newQuantity : 0.0001;
      const newEntryPrice = newValue / safeQuantity;
      const newLiquidationPrice = orderMarginMode === 'cross'
        ? calculateCrossLiquidationPrice(side, newEntryPrice, options.crossMarginPool, newValue)
        : calculateLiquidationPrice(side, newEntryPrice, orderLeverage);
      updated[existingIndex] = {
        ...existing,
        quantity: newQuantity,
        value: newValue,
        margin: newMargin,
        entryPrice: newEntryPrice,
        liquidationPrice: newLiquidationPrice,
        marginMode: orderMarginMode,
        leverage: orderMarginMode === 'cross' ? orderLeverage : existing.leverage,
      };
    } else {
      const safeAvgPrice = fill.avgPrice > 0 && isFinite(fill.avgPrice) ? fill.avgPrice : 0.0001;
      updated.push({
        id: options.makeId(),
        tokenId: fill.tokenId,
        side,
        entryPrice: safeAvgPrice,
        quantity: fill.totalQty,
        value: fill.totalValue,
        leverage: orderLeverage,
        margin: fill.totalValue / orderLeverage,
        liquidationPrice: orderMarginMode === 'cross'
          ? calculateCrossLiquidationPrice(side, safeAvgPrice, options.crossMarginPool, fill.totalValue)
          : calculateLiquidationPrice(side, safeAvgPrice, orderLeverage),
        unrealizedPnl: 0,
        roe: 0,
        marginMode: orderMarginMode,
      });
    }
  });
  return updated;
}

// ==================== 域三-3：玩家强平 ====================

export interface PlayerLiquidationEvaluationInput {
  /** 本回合最新的玩家持仓（结算 + 散户强平 ADL/成交后） */
  positions: FuturesPosition[];
  /** 当前合约盘口（只读） */
  books: Record<string, FuturesOrderBook>;
  /** 代币字典（缺失时该仓位跳过强平判定，原样保留） */
  tokensById: Map<string, Token>;
  availableCapital: number;
  frozenCapital: number;
  /** 浮盈浮亏计算（calculateFuturesPnl 注入） */
  pnlOf: (pos: FuturesPosition, markPrice: number) => { unrealizedPnl: number; roe: number };
  /** 全仓强平价计算（calculateCrossLiquidationPrice 注入） */
  crossLiquidationPriceOf: (side: 'long' | 'short', entryPrice: number, marginPool: number, positionValue: number) => number;
}

export interface PlayerLiquidationEvaluationResult {
  /** 本回合被强平的玩家持仓（顺序与旧实现一致） */
  liquidatedPositions: FuturesPosition[];
  /** 未被强平的持仓（已刷新 unrealizedPnl/roe；全仓连带强平的已剔除） */
  remainingPositions: FuturesPosition[];
  crossMarginPool: number;
  crossLiquidationTriggered: boolean;
}

/**
 * 玩家强平判定（纯函数）：全仓保证金池 + 全仓动态强平价 + 逐仓强平价。
 * 与旧实现逐字一致：全仓触发时所有仓位一并强平。
 */
export function evaluatePlayerLiquidations(input: PlayerLiquidationEvaluationInput): PlayerLiquidationEvaluationResult {
  const liquidatedPlayerPositions: FuturesPosition[] = [];
  const remainingPlayerPositions: FuturesPosition[] = [];

  // 【全仓保证金池】可用现金 + 冻结现金 + 所有仓位正浮盈
  const crossPositivePnl = input.positions.reduce((sum, p) => {
    const book = input.books[p.tokenId];
    if (!book) return sum;
    const { unrealizedPnl } = input.pnlOf(p, book.markPrice);
    return sum + Math.max(0, unrealizedPnl);
  }, 0);
  const crossMarginPool = Math.max(0, input.availableCapital + input.frozenCapital + crossPositivePnl);

  let crossLiquidationTriggered = false;

  input.positions.forEach(pos => {
    const token = input.tokensById.get(pos.tokenId);
    if (!token) return;
    const futuresBook = input.books[pos.tokenId];
    if (!futuresBook) {
      remainingPlayerPositions.push(pos);
      return;
    }
    const marginMode = pos.marginMode || 'cross'; // 旧持仓默认全仓
    let shouldLiquidate = false;

    if (marginMode === 'cross') {
      const positionValue = pos.value || (pos.quantity * pos.entryPrice);
      const crossLiqPrice = input.crossLiquidationPriceOf(pos.side, pos.entryPrice, crossMarginPool, positionValue);
      if (pos.side === 'long' && futuresBook.markPrice <= crossLiqPrice) {
        shouldLiquidate = true;
      } else if (pos.side === 'short' && futuresBook.markPrice >= crossLiqPrice) {
        shouldLiquidate = true;
      }
    } else if (pos.side === 'long' && futuresBook.markPrice <= pos.liquidationPrice) {
      shouldLiquidate = true;
    } else if (pos.side === 'short' && futuresBook.markPrice >= pos.liquidationPrice) {
      shouldLiquidate = true;
    }

    if (shouldLiquidate) {
      if (marginMode === 'cross') crossLiquidationTriggered = true;
      liquidatedPlayerPositions.push(pos);
    } else {
      const { unrealizedPnl, roe } = input.pnlOf(pos, futuresBook.markPrice);
      remainingPlayerPositions.push({ ...pos, unrealizedPnl, roe });
    }
  });

  if (crossLiquidationTriggered) {
    input.positions.forEach(pos => {
      if (!liquidatedPlayerPositions.find(lp => lp.id === pos.id)) liquidatedPlayerPositions.push(pos);
    });
    const liquidatedIds = new Set(liquidatedPlayerPositions.map(p => p.id));
    for (let i = remainingPlayerPositions.length - 1; i >= 0; i--) {
      if (liquidatedIds.has(remainingPlayerPositions[i].id)) remainingPlayerPositions.splice(i, 1);
    }
  }

  return { liquidatedPositions: liquidatedPlayerPositions, remainingPositions: remainingPlayerPositions, crossMarginPool, crossLiquidationTriggered };
}

/** 资金变动操作（App 侧按顺序应用；保持旧实现的 set/add 语义差异） */
export interface LiquidationCashOp {
  target: 'available' | 'frozen';
  kind: 'set' | 'add';
  amount: number;
  /** add 时是否按 Math.max(0, prev + amount) 钳制 */
  clampZero?: boolean;
}

export interface PlayerLiquidationToast {
  message: string;
  type: 'success' | 'error';
}

export interface PlayerLiquidationSettleInput {
  liquidatedPositions: FuturesPosition[];
  /** 未被强平的持仓（evaluatePlayerLiquidations().remainingPositions） */
  remainingPositions: FuturesPosition[];
  /** 当前合约盘口（只读，受影响盘口返回克隆） */
  books: Record<string, FuturesOrderBook>;
  tokens: { id: string; code?: string }[];
  futuresOrders: FuturesOrder[];
  /** 回合开始/进入本段前的持仓（ADL 结算基准，排除已强平仓位） */
  prevPositions: FuturesPosition[];
  retailPositions: RetailPosition[];
  aiTraders: AITrader[];
  aiMarketMakers: AIMarketMaker[];
  round: number;
  makeId: () => string;
  rnd: () => number;
  liquidationPriceOf: (side: 'long' | 'short', entryPrice: number, leverage: number) => number;
  crossLiquidationPriceOf: (side: 'long' | 'short', entryPrice: number, marginPool: number, positionValue: number) => number;
  crossMarginPool: number;
  crossLiquidationTriggered: boolean;
}

export interface PlayerLiquidationSettleResult {
  /** 受影响盘口克隆（App 侧回写本地快照与 state） */
  books: Record<string, FuturesOrderBook>;
  /** 强平笔数 */
  liquidationCount: number;
  /** 资金变动（按旧顺序：逐仓结算/全仓清零 → ADL 结算 → 开仓保证金释放） */
  cashOps: LiquidationCashOp[];
  toasts: PlayerLiquidationToast[];
  /** 待前插的交易流水（已按旧实现最终顺序排好：开仓 → ADL → 强平倒序） */
  tradeHistoryPrepend: FuturesTradeRecord[];
  liquidationDeltas: Record<string, { shortAmount: number; longAmount: number }>;
  adlPlayerPositionUpdates: AdlPlayerPositionUpdate[];
  adlRetailPositionUpdates: AdlRetailPositionUpdate[];
  adlAiPositionUpdates: AdlOwnerPositionUpdate[];
  adlReturnMargin: number;
  adlPnl: number;
  mergedOrderFills: MergedOrderFill[];
  playerOpenFills: PlayerOpenFill[];
  playerOpenMarginTotal: number;
  newRetailPositions: RetailPosition[];
  /** 最终玩家持仓（ADL 更新 + 开仓成交建仓后的全新数组） */
  positionsAfter: FuturesPosition[];
}

/**
 * 玩家强平结算（纯函数）：吃单、ADL 被吃方结算、玩家挂单成交建仓、资金净额。
 * 与旧实现逐字一致：逐仓没收保证金 + 盈亏入可用；全仓触发时现金全部清零。
 */
export function settlePlayerLiquidations(input: PlayerLiquidationSettleInput): PlayerLiquidationSettleResult {
  const clonedBooks: Record<string, FuturesOrderBook> = {};
  const bookFor = (tokenId: string): FuturesOrderBook | null => {
    const cached = clonedBooks[tokenId];
    if (cached) return cached;
    const source = input.books[tokenId];
    if (!source) return null;
    const clone: FuturesOrderBook = { ...source, bids: source.bids.map(b => ({ ...b })), asks: source.asks.map(a => ({ ...a })) };
    clonedBooks[tokenId] = clone;
    return clone;
  };

  const cashOps: LiquidationCashOp[] = [];
  const toasts: PlayerLiquidationToast[] = [];
  const liquidationDeltas: Record<string, { shortAmount: number; longAmount: number }> = {};
  const liquidationTradeRecords: FuturesTradeRecord[] = [];
  const newRetailPositionsFromLiquidation: RetailPosition[] = [];
  const playerLiqAdlFills: AdlFillRecord[] = [];
  const playerLiqLimitOrderFills: RetailLimitFillRecord[] = [];
  const codeOf = (tokenId: string): string => input.tokens.find(t => t.id === tokenId)?.code || '';

  input.liquidatedPositions.forEach(pos => {
    const futuresBook = bookFor(pos.tokenId);
    if (!futuresBook) return;

    const tokenQty = pos.quantity;
    let remainingQty = tokenQty;
    let totalFilledValue = 0;
    let totalFilledQty = 0;

    const consumeLevel = (
      level: { price: number; quantity: number; total: number; isPlayer?: boolean; orderId?: string; isADL?: boolean; adlPositionId?: string; adlOwnerType?: 'player' | 'retail' | 'ai' | 'mm'; adlOwnerId?: string; adlSide?: 'long' | 'short' },
      side: 'long' | 'short',
    ): void => {
      const fillQty = Math.min(remainingQty, level.quantity);
      if (fillQty <= 0.001) return;
      remainingQty -= fillQty;
      level.quantity -= fillQty;
      level.total = level.price * level.quantity;
      totalFilledValue += fillQty * level.price;
      totalFilledQty += fillQty;

      if (level.isADL && level.adlPositionId) {
        playerLiqAdlFills.push({
          positionId: level.adlPositionId,
          isPlayer: level.isPlayer || false,
          ownerType: level.adlOwnerType || (level.isPlayer ? 'player' : 'retail'),
          ownerId: level.adlOwnerId,
          side: level.adlSide || (side === 'long' ? 'long' : 'short'),
          filledQty: fillQty,
          filledValue: fillQty * level.price,
        });
      } else if (level.isPlayer && level.orderId) {
        playerLiqLimitOrderFills.push({
          orderId: level.orderId,
          tokenId: pos.tokenId,
          side: side === 'long' ? 'open_long' : 'open_short',
          filledQty: fillQty,
          filledValue: fillQty * level.price,
          price: level.price,
        });
      } else {
        const fillValue = fillQty * level.price;
        const retailLeverage = 1 + Math.floor(input.rnd() * 5); // 散户杠杆1-5倍随机
        newRetailPositionsFromLiquidation.push({
          id: input.makeId(),
          tokenId: pos.tokenId,
          side: side === 'long' ? 'long' : 'short',
          entryPrice: level.price,
          quantity: fillValue,
          leverage: retailLeverage,
          margin: fillValue / retailLeverage,
          liquidationPrice: input.liquidationPriceOf(side === 'long' ? 'long' : 'short', level.price, retailLeverage),
          createdAt: input.round,
        });
      }
    };

    if (pos.side === 'long') {
      // 多仓强平：卖出，吃买盘
      for (let i = 0; i < futuresBook.bids.length && remainingQty > 0.001; i++) {
        consumeLevel(futuresBook.bids[i], 'long');
      }
      futuresBook.bids = futuresBook.bids.filter(b => b.quantity > 0.001);
      if (remainingQty > 0.001) {
        const bestAsk = futuresBook.asks.length > 0 ? futuresBook.asks[0].price : (futuresBook.lastPrice > 0 ? futuresBook.lastPrice : futuresBook.markPrice);
        const liquidationPrice = bestAsk * 0.99;
        futuresBook.asks.push({ price: liquidationPrice, quantity: remainingQty, total: liquidationPrice * remainingQty, isPlayer: false });
        futuresBook.asks.sort((a, b) => a.price - b.price);
      }
    } else {
      // 空仓强平：买入，吃卖盘
      for (let i = 0; i < futuresBook.asks.length && remainingQty > 0.001; i++) {
        consumeLevel(futuresBook.asks[i], 'short');
      }
      futuresBook.asks = futuresBook.asks.filter(a => a.quantity > 0.001);
      if (remainingQty > 0.001) {
        const bestBid = futuresBook.bids.length > 0 ? futuresBook.bids[0].price : (futuresBook.lastPrice > 0 ? futuresBook.lastPrice : futuresBook.markPrice);
        const liquidationPrice = bestBid * 1.01;
        futuresBook.bids.push({ price: liquidationPrice, quantity: remainingQty, total: liquidationPrice * remainingQty, isPlayer: false });
        futuresBook.bids.sort((a, b) => b.price - a.price);
      }
    }

    futuresBook.totalBidQuantity = futuresBook.bids.reduce((sum, b) => sum + b.quantity, 0);
    futuresBook.totalAskQuantity = futuresBook.asks.reduce((sum, a) => sum + a.quantity, 0);

    const positionValueForPnl = pos.value || (pos.quantity * pos.entryPrice);
    void positionValueForPnl;
    let liquidationPnl = 0;
    if (totalFilledQty > 0) {
      if (pos.side === 'long') {
        liquidationPnl = totalFilledValue - (totalFilledQty * pos.entryPrice);
      } else {
        liquidationPnl = (totalFilledQty * pos.entryPrice) - totalFilledValue;
      }
    }

    if (input.crossLiquidationTriggered && (pos.marginMode || 'cross') === 'cross') {
      cashOps.push({ target: 'available', kind: 'set', amount: 0 });
      cashOps.push({ target: 'frozen', kind: 'set', amount: 0 });
    } else {
      cashOps.push({ target: 'frozen', kind: 'add', amount: -pos.margin, clampZero: true });
      cashOps.push({ target: 'available', kind: 'add', amount: liquidationPnl });
    }

    toasts.push({ message: `⚠️ ${codeOf(pos.tokenId)} ${pos.side === 'long' ? '多' : '空'}单强平`, type: 'error' });

    const positionValue = pos.value || (pos.quantity * pos.entryPrice);
    if (!liquidationDeltas[pos.tokenId]) liquidationDeltas[pos.tokenId] = { shortAmount: 0, longAmount: 0 };
    if (pos.side === 'short') {
      liquidationDeltas[pos.tokenId].shortAmount += positionValue;
    } else {
      liquidationDeltas[pos.tokenId].longAmount += positionValue;
    }

    const avgFillPrice = totalFilledQty > 0 ? totalFilledValue / totalFilledQty : pos.entryPrice;
    liquidationTradeRecords.push({
      id: input.makeId(),
      tokenId: pos.tokenId,
      tokenCode: codeOf(pos.tokenId),
      orderType: 'market',
      action: 'liquidation',
      side: pos.side,
      price: avgFillPrice,
      quantity: pos.quantity,
      value: positionValue,
      pnl: liquidationPnl - pos.margin,
      margin: pos.margin,
      timestamp: input.round,
    });
  });

  // ADL 成交结算
  const adlPlayerPositionUpdates: AdlPlayerPositionUpdate[] = [];
  const adlRetailPositionUpdates: AdlRetailPositionUpdate[] = [];
  const adlAiPositionUpdates: AdlOwnerPositionUpdate[] = [];
  const adlTradeRecords: FuturesTradeRecord[] = [];
  let totalAdlReturnMargin = 0;

  if (playerLiqAdlFills.length > 0) {
    const adlFillsByPosition = new Map<string, { isPlayer: boolean; ownerType: 'player' | 'retail' | 'ai' | 'mm'; ownerId?: string; side: 'long' | 'short'; totalQty: number; totalValue: number }>();
    playerLiqAdlFills.forEach(fill => {
      const existing = adlFillsByPosition.get(fill.positionId);
      if (existing) {
        existing.totalQty += fill.filledQty;
        existing.totalValue += fill.filledValue;
      } else {
        adlFillsByPosition.set(fill.positionId, {
          isPlayer: fill.isPlayer,
          ownerType: fill.ownerType,
          ownerId: fill.ownerId,
          side: fill.side,
          totalQty: fill.filledQty,
          totalValue: fill.filledValue,
        });
      }
    });

    const liquidatedPositionIds = new Set(input.liquidatedPositions.map(p => p.id));

    input.prevPositions.forEach(pos => {
      if (liquidatedPositionIds.has(pos.id)) return;
      const fill = adlFillsByPosition.get(pos.id);
      if (!fill || fill.ownerType !== 'player' || pos.side !== fill.side) return;
      const newQty = pos.quantity - fill.totalQty;
      const avgFillPrice = fill.totalValue / fill.totalQty;
      if (newQty > 0.001) {
        const ratio = newQty / pos.quantity;
        const returnMargin = pos.margin * (1 - ratio);
        totalAdlReturnMargin += returnMargin;
        const pnl = pos.side === 'long'
          ? fill.totalValue - (fill.totalQty * pos.entryPrice)
          : (fill.totalQty * pos.entryPrice) - fill.totalValue;
        adlTradeRecords.push({
          id: input.makeId(), tokenId: pos.tokenId, tokenCode: codeOf(pos.tokenId),
          orderType: 'limit', action: 'adl', side: pos.side, price: avgFillPrice,
          quantity: fill.totalQty, value: fill.totalValue, pnl, margin: returnMargin, timestamp: input.round,
        });
        adlPlayerPositionUpdates.push({
          positionId: pos.id, quantity: newQty,
          value: (pos.value || (pos.quantity * pos.entryPrice)) * ratio,
          margin: pos.margin * ratio, removed: false,
        });
      } else {
        totalAdlReturnMargin += pos.margin;
        const pnl = pos.side === 'long'
          ? fill.totalValue - (pos.quantity * pos.entryPrice)
          : (pos.quantity * pos.entryPrice) - fill.totalValue;
        adlTradeRecords.push({
          id: input.makeId(), tokenId: pos.tokenId, tokenCode: codeOf(pos.tokenId),
          orderType: 'limit', action: 'adl', side: pos.side, price: avgFillPrice,
          quantity: pos.quantity, value: fill.totalValue, pnl, margin: pos.margin, timestamp: input.round,
        });
        adlPlayerPositionUpdates.push({ positionId: pos.id, quantity: 0, value: 0, margin: 0, removed: true });
      }
    });

    // 散户 ADL
    input.retailPositions.forEach(pos => {
      const fill = adlFillsByPosition.get(pos.id);
      if (!fill || fill.ownerType !== 'retail' || pos.side !== fill.side) return;
      const tokenQty = pos.quantity / pos.entryPrice;
      const newQty = tokenQty - fill.totalQty;
      if (newQty > 0.001) {
        adlRetailPositionUpdates.push({ positionId: pos.id, quantity: newQty * pos.entryPrice, removed: false });
      } else {
        adlRetailPositionUpdates.push({ positionId: pos.id, quantity: 0, removed: true });
      }
    });

    // AI / 做市商 ADL
    const collectOwnerUpdates = (ownerType: 'ai' | 'mm', id: string, pos: { tokenId: string; side: 'long' | 'short'; quantity: number; entryPrice: number; margin: number }): void => {
      const key = `${id}|${pos.tokenId}|${pos.side}`;
      const fill = adlFillsByPosition.get(key);
      if (!fill || fill.ownerType !== ownerType || pos.side !== fill.side) return;
      const newQty = pos.quantity - fill.totalQty;
      const ratio = newQty > 0.001 ? newQty / pos.quantity : 0;
      const pnl = pos.side === 'long'
        ? fill.totalValue - (fill.totalQty * pos.entryPrice)
        : (fill.totalQty * pos.entryPrice) - fill.totalValue;
      adlAiPositionUpdates.push({
        ownerType, ownerId: id, tokenId: pos.tokenId, side: pos.side,
        quantity: ratio > 0 ? newQty : 0,
        returnMargin: pos.margin * (1 - ratio),
        pnl, removed: ratio <= 0,
      });
    };
    input.aiTraders.forEach(trader => (trader.futuresPositions || []).forEach(pos => collectOwnerUpdates('ai', trader.id, pos)));
    input.aiMarketMakers.forEach(mm => (mm.futuresPositions || []).forEach(pos => collectOwnerUpdates('mm', mm.id, pos)));
  }

  if (totalAdlReturnMargin > 0 || adlTradeRecords.some(r => (r.pnl || 0) !== 0)) {
    const totalPnl = adlTradeRecords.reduce((sum, r) => sum + (r.pnl || 0), 0);
    cashOps.push({ target: 'available', kind: 'add', amount: totalAdlReturnMargin + totalPnl });
    cashOps.push({ target: 'frozen', kind: 'add', amount: -totalAdlReturnMargin, clampZero: true });
  }

  // 玩家限价单成交（玩家强平吃单触发）
  const fillsByOrder = new Map<string, { tokenId: string; side: 'open_long' | 'open_short'; totalQty: number; totalValue: number; avgPrice: number }>();
  playerLiqLimitOrderFills.forEach(fill => {
    const existing = fillsByOrder.get(fill.orderId);
    if (existing) {
      const newTotalQty = existing.totalQty + fill.filledQty;
      const newTotalValue = existing.totalValue + fill.filledValue;
      fillsByOrder.set(fill.orderId, { tokenId: fill.tokenId, side: fill.side, totalQty: newTotalQty, totalValue: newTotalValue, avgPrice: newTotalValue / newTotalQty });
    } else {
      fillsByOrder.set(fill.orderId, { tokenId: fill.tokenId, side: fill.side, totalQty: fill.filledQty, totalValue: fill.filledValue, avgPrice: fill.filledValue / fill.filledQty });
    }
  });

  const mergedOrderFills: MergedOrderFill[] = [];
  fillsByOrder.forEach((fill, orderId) => {
    mergedOrderFills.push({ orderId, totalQty: fill.totalQty, totalValue: fill.totalValue, avgPrice: fill.avgPrice });
  });

  const newPositionsFromFills: FuturesPosition[] = [];
  const openTradeRecords: FuturesTradeRecord[] = [];
  let playerOpenMarginTotal = 0;
  let playerOpenFillCount = 0;

  const playerOpenFills: PlayerOpenFill[] = [];
  if (fillsByOrder.size > 0) {
    fillsByOrder.forEach((fill, orderId) => {
      if (fill.side !== 'open_long' && fill.side !== 'open_short') return;
      const order = input.futuresOrders.find(o => o.id === orderId);
      playerOpenFills.push({
        orderId,
        tokenId: fill.tokenId,
        side: fill.side,
        totalQty: fill.totalQty,
        totalValue: fill.totalValue,
        avgPrice: fill.avgPrice,
        leverage: order?.leverage || 10,
        marginMode: order?.marginMode || 'cross',
      });
    });

    playerOpenFills.forEach(fill => {
      if (fill.totalQty <= 0 || fill.totalValue <= 0) return;
      const side = fill.side === 'open_long' ? 'long' : 'short';
      const safeAvgPrice = fill.avgPrice > 0 && isFinite(fill.avgPrice) ? fill.avgPrice : 0.0001;
      const liquidationPrice = fill.marginMode === 'cross'
        ? input.crossLiquidationPriceOf(side, safeAvgPrice, input.crossMarginPool, fill.totalValue)
        : input.liquidationPriceOf(side, safeAvgPrice, fill.leverage);
      newPositionsFromFills.push({
        id: input.makeId(),
        tokenId: fill.tokenId,
        side,
        entryPrice: safeAvgPrice,
        quantity: fill.totalQty,
        value: fill.totalValue,
        leverage: fill.leverage,
        margin: fill.totalValue / fill.leverage,
        liquidationPrice,
        marginMode: fill.marginMode,
        unrealizedPnl: 0,
        roe: 0,
      });
    });

    if (newPositionsFromFills.length > 0) {
      playerOpenMarginTotal = playerOpenFills.reduce((sum, fill) => sum + fill.totalValue / fill.leverage, 0);
      playerOpenFillCount = playerOpenFills.length;
      if (playerOpenMarginTotal > 0) {
        cashOps.push({ target: 'frozen', kind: 'add', amount: -playerOpenMarginTotal, clampZero: true });
      }
      playerOpenFills.forEach(fill => {
        openTradeRecords.push({
          id: input.makeId(),
          tokenId: fill.tokenId,
          tokenCode: codeOf(fill.tokenId),
          orderType: 'limit',
          action: 'open',
          side: fill.side === 'open_long' ? 'long' : 'short',
          price: fill.avgPrice,
          quantity: fill.totalQty,
          value: fill.totalValue,
          timestamp: input.round,
        });
      });
      // 为玩家成交创建散户对手方持仓
      playerOpenFills.forEach(fill => {
        if (fill.totalValue <= 0) return;
        const retailSide = fill.side === 'open_long' ? 'short' : 'long';
        const retailLeverage = 1 + Math.floor(input.rnd() * 5);
        newRetailPositionsFromLiquidation.push({
          id: input.makeId(),
          tokenId: fill.tokenId,
          side: retailSide,
          entryPrice: fill.avgPrice,
          quantity: fill.totalValue,
          leverage: retailLeverage,
          margin: fill.totalValue / retailLeverage,
          liquidationPrice: input.liquidationPriceOf(retailSide, fill.avgPrice, retailLeverage),
          createdAt: input.round,
        });
      });
      toasts.push({ message: `${playerOpenFillCount}个合约限价单已成交`, type: 'success' });
    }
  }

  // 持仓结果：ADL 更新 → 开仓成交建仓
  let positionsAfter = applyAdlPlayerPositionUpdates(input.remainingPositions, adlPlayerPositionUpdates);
  if (newPositionsFromFills.length > 0) {
    positionsAfter = [...positionsAfter, ...newPositionsFromFills];
  }

  // 交易流水最终顺序：开仓 → ADL → 强平倒序（对应旧实现逐条前插）
  const tradeHistoryPrepend: FuturesTradeRecord[] = [
    ...openTradeRecords,
    ...adlTradeRecords,
    ...liquidationTradeRecords.slice().reverse(),
  ];

  return {
    books: clonedBooks,
    liquidationCount: input.liquidatedPositions.length,
    cashOps,
    toasts,
    tradeHistoryPrepend,
    liquidationDeltas,
    adlPlayerPositionUpdates,
    adlRetailPositionUpdates,
    adlAiPositionUpdates,
    adlReturnMargin: totalAdlReturnMargin,
    adlPnl: adlTradeRecords.reduce((sum, r) => sum + (r.pnl || 0), 0),
    mergedOrderFills,
    playerOpenFills,
    playerOpenMarginTotal,
    newRetailPositions: newRetailPositionsFromLiquidation,
    positionsAfter,
  };
}


// ============================================================================
// 域三-4：情绪驱动散户持仓生成（纯函数）
// ----------------------------------------------------------------------------
// 原逻辑位于 handleFastForward 的 setRetailPositions(prev => {...}) 内，约 250 行。
// 本函数只做「持仓衰减 + 按情绪生成」，不做任何 React state 操作，也不修改入参数组。
// 注意：OI（未平仓合约）强制轧差机制已彻底移除——多空比不再被人为校准为 1:1，
//      由真实成交、强平、ADL 与情绪生成自然形成。
// 随机数顺序与原实现严格一致：按 tokens 顺序，每 token 先衰减后生成；
// 生成时先杠杆 rnd()，再反向仓杠杆 rnd()（杠杆取值区间随情绪变化）。
// ============================================================================
export interface RetailSentimentInput {
  /** 上一回合的散户持仓（只读，不修改） */
  retailPositions: RetailPosition[];
  /** 本回合更新后的代币列表（用于市值/价格/情绪） */
  tokens: Token[];
  /** 玩家合约持仓（用于计算玩家多空价值，纳入持仓上限判定） */
  playerPositions: FuturesPosition[];
  /** 聪明钱交易员总数 = AI 交易员 + 做市商 */
  smartMoneyTraderCount: number;
  /** 代币热度（<30 触发衰减） */
  heatOf: (tokenId: string) => number;
  /** 合约标记价；undefined 时回退 token.currentPrice */
  markPriceOf: (tokenId: string) => number | undefined;
  round: number;
  change24hOf: (token: Token) => number;
  sentimentOf: (change24h: number) => { label: string };
  makeId: () => string;
  rnd: () => number;
  liquidationPriceOf: (side: 'long' | 'short', price: number, leverage: number) => number;
}

export function generateRetailBySentiment(input: RetailSentimentInput): RetailPosition[] {
  const {
    retailPositions,
    tokens,
    playerPositions,
    smartMoneyTraderCount,
    heatOf,
    markPriceOf,
    round,
    change24hOf,
    sentimentOf,
    makeId,
    rnd,
    liquidationPriceOf,
  } = input;

  const finalRetailPositions: RetailPosition[] = [];

  tokens.forEach(token => {
    const tokenHeat = heatOf(token.id);
    const change24h = change24hOf(token);
    const sentiment = sentimentOf(change24h);

    const tokenRetailPositions = retailPositions.filter(p => p.tokenId === token.id);
    const tokenPlayerPositions = playerPositions.filter(p => p.tokenId === token.id);

    // 玩家多空持仓量（金额单位）
    const playerLongValue = tokenPlayerPositions
      .filter(p => p.side === 'long')
      .reduce((sum, p) => sum + (p.value || (p.quantity * p.entryPrice)), 0);
    const playerShortValue = tokenPlayerPositions
      .filter(p => p.side === 'short')
      .reduce((sum, p) => sum + (p.value || (p.quantity * p.entryPrice)), 0);

    // 散户多空持仓量
    const retailLongPositions = tokenRetailPositions.filter(p => p.side === 'long');
    const retailShortPositions = tokenRetailPositions.filter(p => p.side === 'short');
    const retailLongValue = retailLongPositions.reduce((sum, p) => sum + p.quantity, 0);
    const retailShortValue = retailShortPositions.reduce((sum, p) => sum + p.quantity, 0);

    const totalLongValue = playerLongValue + retailLongValue;
    const totalShortValue = playerShortValue + retailShortValue;
    const totalPositionValue = totalLongValue + totalShortValue;

    // 有效市值（仅已解锁流通量）
    const effectiveMarketCap = token.currentPrice * token.circulatingSupply;

    // 持仓上限：市场总持仓量达到有效市值的 3% 时暂停生成
    // （原为 100 倍市值，会让散户持仓无限膨胀，导致单次强平金额远超市场成交量）
    const positionLimit = effectiveMarketCap * 0.03;
    const isOverPositionLimit = totalPositionValue > positionLimit && effectiveMarketCap > 0;

    const markPrice = markPriceOf(token.id) ?? token.currentPrice;

    // 衰减机制（仅作用于散户持仓；玩家与 AI 合约仓位不参与）
    // 热度 < 30 且多空双方都有散户仓时：按较少一方总仓位的 5% 双向等量平仓
    if (tokenHeat < 30 && retailLongValue > 0 && retailShortValue > 0) {
      const minSideValue = Math.min(retailLongValue, retailShortValue);
      const decayAmount = minSideValue * 0.05;

      const updatedLongPositions: RetailPosition[] = [];
      for (const pos of retailLongPositions) {
        const posDecay = retailLongValue > 0 ? pos.quantity * (decayAmount / retailLongValue) : 0;
        const newQuantity = pos.quantity - posDecay;
        if (newQuantity > 0.001) {
          const ratio = newQuantity / pos.quantity;
          updatedLongPositions.push({ ...pos, quantity: newQuantity, margin: pos.margin * ratio });
        }
      }

      const updatedShortPositions: RetailPosition[] = [];
      for (const pos of retailShortPositions) {
        const posDecay = retailShortValue > 0 ? pos.quantity * (decayAmount / retailShortValue) : 0;
        const newQuantity = pos.quantity - posDecay;
        if (newQuantity > 0.001) {
          const ratio = newQuantity / pos.quantity;
          updatedShortPositions.push({ ...pos, quantity: newQuantity, margin: pos.margin * ratio });
        }
      }

      finalRetailPositions.push(...updatedLongPositions, ...updatedShortPositions);
    } else {
      finalRetailPositions.push(...tokenRetailPositions);
    }

    // 情绪驱动生成（未超持仓上限时）
    if (!isOverPositionLimit && smartMoneyTraderCount > 0 && effectiveMarketCap > 0) {
      const pushPosition = (
        side: 'long' | 'short',
        leverage: number,
        singlePositionValue: number,
      ) => {
        const margin = singlePositionValue / leverage;
        finalRetailPositions.push({
          id: makeId(),
          tokenId: token.id,
          side,
          entryPrice: markPrice,
          quantity: singlePositionValue,
          leverage,
          margin,
          liquidationPrice: liquidationPriceOf(side, markPrice, leverage),
          createdAt: round,
        });
      };

      if (sentiment.label === '极度贪婪') {
        // 极度贪婪：n 个多头（聪明钱 × 20%），杠杆 2-10x，单仓 0.02% 市值，外加 1 个反向空头
        const n = Math.max(1, Math.floor(smartMoneyTraderCount * 0.2));
        const singlePositionValue = effectiveMarketCap * 0.0002;
        for (let i = 0; i < n; i++) {
          pushPosition('long', 2 + Math.floor(rnd() * 9), singlePositionValue);
        }
        pushPosition('short', 2 + Math.floor(rnd() * 9), singlePositionValue);
      } else if (sentiment.label === '贪婪') {
        // 贪婪：m 个多头（聪明钱 × 10%），杠杆 1-5x，单仓 0.01% 市值，外加 1 个反向空头
        const m = Math.max(1, Math.floor(smartMoneyTraderCount * 0.1));
        const singlePositionValue = effectiveMarketCap * 0.0001;
        for (let i = 0; i < m; i++) {
          pushPosition('long', 1 + Math.floor(rnd() * 5), singlePositionValue);
        }
        pushPosition('short', 1 + Math.floor(rnd() * 5), singlePositionValue);
      } else if (sentiment.label === '极度恐慌') {
        // 极度恐慌：n 个空头（聪明钱 × 20%），杠杆 2-10x，单仓 0.02% 市值，外加 1 个反向多头
        const n = Math.max(1, Math.floor(smartMoneyTraderCount * 0.2));
        const singlePositionValue = effectiveMarketCap * 0.0002;
        for (let i = 0; i < n; i++) {
          pushPosition('short', 2 + Math.floor(rnd() * 9), singlePositionValue);
        }
        pushPosition('long', 2 + Math.floor(rnd() * 9), singlePositionValue);
      } else if (sentiment.label === '恐慌') {
        // 恐慌：m 个空头（聪明钱 × 10%），杠杆 1-5x，单仓 0.01% 市值，外加 1 个反向多头
        const m = Math.max(1, Math.floor(smartMoneyTraderCount * 0.1));
        const singlePositionValue = effectiveMarketCap * 0.0001;
        for (let i = 0; i < m; i++) {
          pushPosition('short', 1 + Math.floor(rnd() * 5), singlePositionValue);
        }
        pushPosition('long', 1 + Math.floor(rnd() * 5), singlePositionValue);
      }
      // 其他情绪（乐观、中性、担忧）不生成新持仓
    }
  });

  return finalRetailPositions;
}
