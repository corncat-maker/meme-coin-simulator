// 从 src/App.tsx 机械搬迁（域四-2）：上下架判定纯函数。
// 只做判定与计划计算，不执行任何副作用（不 setState / 不 showToast / 不修改入参对象）。
import type {
  AITrader,
  AIMarketMaker,
  Candle,
  DelistReason,
  FuturesPosition,
  LiquidityPool,
  RetailPosition,
  Token,
} from '../types';
import {
  canListFutures,
  computeAvgMarketCap7d,
  computeToken24hTurnover,
  DELIST_LIQUIDITY_MIN_AVG_MARKET_CAP_7D,
  getDelistTriggerReason,
} from './delist';

interface DelistPositionRef {
  actor: 'player' | 'retail' | 'ai' | 'mm';
  actorId?: string;
  feature?: string;
  playerId?: string;
  tokenId: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  pnlAtAdl: number;
  closePrice?: number;
}

export interface ListingDelistInput {
  tokens: Token[];
  newRound: number;
  liquidityPools: Record<string, LiquidityPool>;
  tokenCandlesMap: Record<string, Candle[]>;
  futuresPositions: FuturesPosition[];
  retailPositions: RetailPosition[];
  aiTraders: AITrader[];
  aiMarketMakers: AIMarketMaker[];
  maxHolderPercentMap: Record<string, number>;
  maxSingleHolderPercentMap: Record<string, number>;
  bidAskOf: (tokenId: string) => { bid: number; ask: number };
}

export interface ListingDelistDecision {
  delistPendingTokenIds: Set<string>;
  futuresPendingTokenIds: Set<string>;
  delistedTokensWithReason: { id: string; code: string; reason: DelistReason }[];
  newlyPendingDelistTokens: { code: string; name: string; reason: DelistReason; delistRound: number }[];
  delistStateUpdates: Map<string, Partial<Token>>;
  delistAvgPriceByToken: Record<string, number>;
  delistResidualAvgEntryByToken: Record<string, number>;
  newlyPendingListTokens: { code: string; name: string; listRound: number }[];
  newlyListedTokens: { id: string; code: string; name: string }[];
  listingStateUpdates: Map<string, Partial<Token>>;
  playerClosePrice: Map<string, number>;
  aiClosePrices: Map<string, number[]>;
  mmClosePrices: Map<string, number[]>;
}

export function computeListingDelistDecisions(input: ListingDelistInput): ListingDelistDecision {
  const {
    tokens,
    newRound,
    liquidityPools,
    tokenCandlesMap,
    futuresPositions,
    retailPositions,
    aiTraders,
    aiMarketMakers,
    maxHolderPercentMap,
    maxSingleHolderPercentMap,
    bidAskOf,
  } = input;

    // 【下架公告机制】预计算本回合将新发出下架公告的代币ID集合
    // 用于：公告发出当回合的利空1级效果 + 即将下架期间的盘口订单生成调整
    const delistPendingTokenIdsThisRound = new Set<string>();
    tokens.forEach(token => {
      // 已下架或已在下架倒计时中的代币跳过
      if (token.futuresListed === false) return;
      if (token.delistPendingRound && token.delistScheduledRound && token.delistScheduledRound > newRound) return;
      const pool = liquidityPools[token.id];
      if (!pool) return;
      const reason = getDelistTriggerReason(
        token,
        pool,
        maxHolderPercentMap[token.id] || 0,
        maxSingleHolderPercentMap[token.id] || 0,
        newRound
      );
      if (reason) delistPendingTokenIdsThisRound.add(token.id);
    });

    // 【合约上架公告机制】预计算本回合将新发出上架公告的初始化未上架代币ID集合
    // 用于：公告发出当回合的利多1级效果。仅处理初始化时未上架（无下架记录）的代币
    const futuresPendingTokenIdsThisRound = new Set<string>();
    tokens.forEach(token => {
      // 已上架 / 已下架（走重新上架机制）/ 已有上架计划（含本回合正式上架）的代币跳过
      if (token.futuresListed !== false) return;
      if (token.delistedRound) return;
      if (token.futuresScheduledRound && token.futuresScheduledRound >= newRound) return;
      const pool = liquidityPools[token.id];
      if (!pool) return;
      // 满足上架标准（市值≥10M、流动性池USDT储备≥1M、24小时成交额≥1M）后即可安排上架
      if (canListFutures(token.marketCap, pool.quoteReserve, computeToken24hTurnover(tokenCandlesMap[token.id]))) {
        futuresPendingTokenIdsThisRound.add(token.id);
      }
    });

    // ========== 下架检测与强平预计算（同步执行，修复强制平仓未触发问题） ==========
    // 原实现将 delistedTokensWithReason / newlyPendingDelistTokens 在 setTokens 更新函数内收集，
    // React 18 异步执行导致后续同步代码读到空数组，强制平仓块整体被跳过。
    // 此处改为同步预计算，产出：
    // 1. 正式下架（delistScheduledRound <= newRound）→ delistedTokensWithReason + 状态更新
    // 2. 下架前4小时（delistScheduledRound - newRound === 4）→ 记录近24小时平均价 delistAvgPrice
    // 3. 新触发下架条件 → newlyPendingDelistTokens + 倒计时状态更新
    // 4. 正式下架代币 → 四步强平结算价计划 + 残留仓位平均开仓价（下回合现货盘口基准价）
    const delistedTokensWithReason: { id: string; code: string; reason: DelistReason }[] = [];
    const newlyPendingDelistTokens: { code: string; name: string; reason: DelistReason; delistRound: number }[] = [];
    const delistStateUpdates = new Map<string, Partial<Token>>();
    const delistAvgPriceByToken: Record<string, number> = {};
    const delistResidualAvgEntryByToken: Record<string, number> = {};
    // 初始化未上架合约代币的上架计划预计算
    const newlyPendingListTokens: { code: string; name: string; listRound: number }[] = [];
    const newlyListedTokens: { id: string; code: string; name: string }[] = [];
    const listingStateUpdates = new Map<string, Partial<Token>>();

    // 近24小时平均价（最近24根K线收盘均值，不足时回退盘口中间价/收盘价/当前价）
    const computeDelistAvgPrice = (tokenId: string): number => {
      const tokenCandles = tokenCandlesMap[tokenId];
      let avgPrice = 0;
      if (Array.isArray(tokenCandles) && tokenCandles.length > 0) {
        const recentCandles = tokenCandles.slice(-24);
        avgPrice = recentCandles.reduce((acc, c) => acc + (c.close || 0), 0) / recentCandles.length;
      }
      if (avgPrice <= 0) {
        const lastCandle = tokenCandles?.[tokenCandles.length - 1];
        const { bid: bidPrice, ask: askPrice } = bidAskOf(tokenId);
        const tk = tokens.find(t => t.id === tokenId);
        avgPrice = (bidPrice > 0 && askPrice > 0) ? (bidPrice + askPrice) / 2 : (lastCandle?.close || tk?.currentPrice || 0);
      }
      return avgPrice;
    };

    tokens.forEach(token => {
      // ===== 0. 初始化未上架合约代币：到达计划上架回合 → 正式上架（不进观察） =====
      if (token.futuresScheduledRound && token.futuresScheduledRound <= newRound && token.futuresListed === false && !token.delistedRound) {
        newlyListedTokens.push({ id: token.id, code: token.code, name: token.name });
        listingStateUpdates.set(token.id, {
          futuresListed: true,
          futuresPendingRound: undefined,
          futuresScheduledRound: undefined,
        });
        return;
      }

      // ===== 0.4 玩家发行代币【模块四】：满足合约上架条件 → 当回合立即上架，跳过公告与 72 回合等待 =====
      if (token.isPlayerCreated && token.futuresListed === false && !token.delistedRound) {
        // 已在排队/计划中则先清空（玩家代币不走排队流程）
        if (!token.futuresPendingRound && !token.futuresScheduledRound) {
          const playerPool = liquidityPools[token.id];
          if (playerPool && canListFutures(token.marketCap, playerPool.quoteReserve, Number.POSITIVE_INFINITY)) {
            newlyListedTokens.push({ id: token.id, code: token.code, name: token.name });
            listingStateUpdates.set(token.id, {
              futuresListed: true,
              futuresPendingRound: undefined,
              futuresScheduledRound: undefined,
            });
            return;
          }
        }
        return;
      }

      // ===== 0.5 初始化未上架合约代币：满足上架标准 → 当回合发出上架公告，3天（72回合）后正式上架 =====
      if (token.futuresListed === false && !token.delistedRound) {
        // 已有上架计划或本回合已正式上架则跳过
        if (token.futuresScheduledRound && token.futuresScheduledRound > newRound) return;
        const pool = liquidityPools[token.id];
        if (!pool) return;
        // 上架标准：市值≥10M、流动性池USDT储备≥1M、24小时成交额≥1M（成交金额）
        if (canListFutures(token.marketCap, pool.quoteReserve, computeToken24hTurnover(tokenCandlesMap[token.id]))) {
          const listRound = newRound + 72; // 3天后正式上架
          newlyPendingListTokens.push({ code: token.code, name: token.name, listRound });
          listingStateUpdates.set(token.id, {
            futuresPendingRound: newRound,
            futuresScheduledRound: listRound,
          });
        }
        return;
      }

      // ===== 1. 到达计划下架回合：正式下架（合约市场） =====
      if (token.delistScheduledRound && token.delistScheduledRound <= newRound && token.futuresListed !== false) {
        const reason: DelistReason = token.delistReason || 'liquidity';
        delistedTokensWithReason.push({ id: token.id, code: token.code, reason });
        delistStateUpdates.set(token.id, {
          futuresListed: false, // 仅下架合约市场，CEX保持上架
          delistedRound: newRound,
          delistReason: reason,
          delistPendingRound: undefined,
          delistScheduledRound: undefined,
        });
        return;
      }

      // 已经下架合约市场的代币跳过
      if (token.futuresListed === false) return;
      // 正在下架倒计时中的代币：到达下架前4小时时记录平均价格
      if (token.delistPendingRound && token.delistScheduledRound && token.delistScheduledRound > newRound) {
        if (token.delistScheduledRound - newRound === 4 && !token.delistAvgPrice) {
          const avgPrice = computeDelistAvgPrice(token.id);
          if (avgPrice > 0) {
            delistAvgPriceByToken[token.id] = avgPrice;
            delistStateUpdates.set(token.id, { delistAvgPrice: avgPrice });
          }
        }
        return;
      }

      // BTC和ETH不会被操纵嫌疑或合约操纵下架
      const isBTCorETH = token.code === 'BTC' || token.code === 'ETH';

      // 获取该代币的流动性池
      const pool = liquidityPools[token.id];
      if (!pool) return; // 没有流动性池，保持原状态

      // 【性能优化】使用预计算的最大持仓占比
      const maxHolderPercent = maxHolderPercentMap[token.id] || 0;

      // 条件1：流动性不足下架（近7日平均市值 < 3M）
      if (computeAvgMarketCap7d(token) < DELIST_LIQUIDITY_MIN_AVG_MARKET_CAP_7D) {
        const delistRound = newRound + 72; // 3天后正式下架
        newlyPendingDelistTokens.push({ code: token.code, name: token.name, reason: 'liquidity', delistRound });
        delistStateUpdates.set(token.id, {
          delistPendingRound: newRound,
          delistScheduledRound: delistRound,
          delistReason: 'liquidity',
        });
        return;
      }

      // 条件2：操纵嫌疑下架（除BTC/ETH）
      if (!isBTCorETH) {
        // 【观察标签机制】观察标签代币：玩家或某交易员、做市商单人持仓超过总供应量90%即以操纵嫌疑下架
        const isWatchedToken = token.watchEndRound !== undefined && token.watchEndRound !== null && token.watchEndRound > newRound;
        const maxSingleHolderPercent = maxSingleHolderPercentMap[token.id] || 0;
        if (isWatchedToken && maxSingleHolderPercent > 0.9) {
          const delistRound = newRound + 72;
          newlyPendingDelistTokens.push({ code: token.code, name: token.name, reason: 'manipulation', delistRound });
          delistStateUpdates.set(token.id, {
            delistPendingRound: newRound,
            delistScheduledRound: delistRound,
            delistReason: 'manipulation',
          });
          return;
        }
        const liquidationAmount24h = token.liquidationAmount24h || 0;
        const marketCapHistory = token.marketCapHistory || [];
        if (marketCapHistory.length >= 2) {
          const marketCaps = marketCapHistory.map(h => h.marketCap);
          const maxMarketCap = Math.max(...marketCaps);
          const minMarketCap = Math.min(...marketCaps);
          const marketCapFluctuation = maxMarketCap - minMarketCap;

          // 合并条件：强平金额 > 5B 且 市值波动 > 10B 且 单一持币者 > 50%
          if (liquidationAmount24h > 5000000000 && marketCapFluctuation > 10000000000 && maxHolderPercent > 0.5) {
            const delistRound = newRound + 72;
            newlyPendingDelistTokens.push({ code: token.code, name: token.name, reason: 'manipulation', delistRound });
            delistStateUpdates.set(token.id, {
              delistPendingRound: newRound,
              delistScheduledRound: delistRound,
              delistReason: 'manipulation',
            });
            return;
          }
        }
      }

      // 条件3：诈骗嫌疑下架
      // 24h跌幅 > 90% 且 流动性池USDT < 初始流动性的10%
      const priceChange24h = token.change24h;
      const initialLiquidityUsdt = token.initialLiquidityUsdt || pool.quoteReserve;
      if (priceChange24h < -90 && initialLiquidityUsdt > 0 && pool.quoteReserve < initialLiquidityUsdt * 0.1) {
        const delistRound = newRound + 72;
        newlyPendingDelistTokens.push({ code: token.code, name: token.name, reason: 'fraud', delistRound });
        delistStateUpdates.set(token.id, {
          delistPendingRound: newRound,
          delistScheduledRound: delistRound,
          delistReason: 'fraud',
        });
      }
    });

    // ===== 正式下架代币：预计算四步强制平仓的结算计划 =====
    // 步骤2/3：盈利仓位按平均价ADL挂单，亏损仓位市价吃单（成交价均为记录的平均价）
    // 步骤4：未成交的残留仓位按加权平均开仓价强制结算；该均价同时作为下回合现货盘口生成基准价
    // 结算价计划在 handler 作用域声明，供下架当回合的强制平仓块使用
    const playerClosePrice = new Map<string, number>();
    const aiClosePrices = new Map<string, number[]>();
    const mmClosePrices = new Map<string, number[]>();

    if (delistedTokensWithReason.length > 0) {
      const delistedTokenIds = new Set(delistedTokensWithReason.map(d => d.id));
      // 下架结算价：优先使用24小时前记录的平均价，缺失时当回合现算
      delistedTokensWithReason.forEach(d => {
        const token = tokens.find(t => t.id === d.id);
        const recordedAvg = typeof token?.delistAvgPrice === 'number' && token.delistAvgPrice > 0 ? token.delistAvgPrice : 0;
        delistAvgPriceByToken[d.id] = recordedAvg > 0 ? recordedAvg : computeDelistAvgPrice(d.id);
      });


      const calcPnlAt = (side: 'long' | 'short', entryPrice: number, closePrice: number, quantity: number) =>
        side === 'long' ? (closePrice - entryPrice) * quantity : (entryPrice - closePrice) * quantity;

      // 收集全部仓位类型（玩家/散户/AI交易员/做市商）
      const allRefs: DelistPositionRef[] = [];
      futuresPositions.forEach(p => {
        if (!delistedTokenIds.has(p.tokenId)) return;
        allRefs.push({
          actor: 'player', playerId: p.id, tokenId: p.tokenId, side: p.side,
          entryPrice: p.entryPrice, quantity: p.quantity,
          pnlAtAdl: calcPnlAt(p.side, p.entryPrice, delistAvgPriceByToken[p.tokenId] || p.entryPrice, p.quantity),
        });
      });
      retailPositions.forEach(p => {
        if (!delistedTokenIds.has(p.tokenId)) return;
        allRefs.push({
          actor: 'retail', playerId: p.id, tokenId: p.tokenId, side: p.side,
          entryPrice: p.entryPrice, quantity: p.quantity,
          pnlAtAdl: calcPnlAt(p.side, p.entryPrice, delistAvgPriceByToken[p.tokenId] || p.entryPrice, p.quantity),
        });
      });
      aiTraders.forEach(trader => {
        trader.futuresPositions.forEach(p => {
          if (!delistedTokenIds.has(p.tokenId)) return;
          allRefs.push({
            actor: 'ai', actorId: trader.id, tokenId: p.tokenId, side: p.side,
            entryPrice: p.entryPrice, quantity: p.quantity,
            feature: `${p.tokenId}|${p.side}|${p.entryPrice}|${p.quantity}|${p.margin}`,
            pnlAtAdl: calcPnlAt(p.side, p.entryPrice, delistAvgPriceByToken[p.tokenId] || p.entryPrice, p.quantity),
          });
        });
      });
      aiMarketMakers.forEach(mm => {
        mm.futuresPositions.forEach(p => {
          if (!delistedTokenIds.has(p.tokenId)) return;
          allRefs.push({
            actor: 'mm', actorId: mm.id, tokenId: p.tokenId, side: p.side,
            entryPrice: p.entryPrice, quantity: p.quantity,
            feature: `${p.tokenId}|${p.side}|${p.entryPrice}|${p.quantity}|${p.margin}`,
            pnlAtAdl: calcPnlAt(p.side, p.entryPrice, delistAvgPriceByToken[p.tokenId] || p.entryPrice, p.quantity),
          });
        });
      });

      const refsByToken: Record<string, DelistPositionRef[]> = {};
      allRefs.forEach(r => {
        (refsByToken[r.tokenId] || (refsByToken[r.tokenId] = [])).push(r);
      });

      Object.keys(refsByToken).forEach(tokenId => {
        const adlPrice = delistAvgPriceByToken[tokenId] || 0;
        const refs = refsByToken[tokenId];
        // 盈利仓位（ADL挂单方）：盈利空头挂买单、盈利多头挂卖单
        const bidProviders = refs.filter(r => r.side === 'short' && r.pnlAtAdl > 0);
        const askProviders = refs.filter(r => r.side === 'long' && r.pnlAtAdl > 0);
        // 亏损仓位（市价吃单方）：亏损多头市价卖吃买单、亏损空头市价买吃卖单
        const bidConsumers = refs.filter(r => r.side === 'long' && r.pnlAtAdl <= 0);
        const askConsumers = refs.filter(r => r.side === 'short' && r.pnlAtAdl <= 0);
        const sumQty = (list: DelistPositionRef[]) => list.reduce((s, r) => s + r.quantity, 0);
        const bidMatchedQty = Math.min(sumQty(bidProviders), sumQty(bidConsumers));
        const askMatchedQty = Math.min(sumQty(askProviders), sumQty(askConsumers));

        // 按序配对（顺序优先），未配对部分进入残留
        const residualRefs: DelistPositionRef[] = [];
        const assignMatched = (list: DelistPositionRef[], matchedQty: number) => {
          let remainingMatched = matchedQty;
          for (let i = list.length - 1; i >= 0; i--) {
            const r = list[i];
            if (remainingMatched >= r.quantity) {
              r.closePrice = adlPrice;
              remainingMatched -= r.quantity;
            } else if (remainingMatched > 0) {
              residualRefs.push(r);
              remainingMatched = 0;
            } else {
              residualRefs.push(r);
            }
          }
        };
        assignMatched(bidProviders, bidMatchedQty);
        assignMatched(bidConsumers, bidMatchedQty);
        assignMatched(askProviders, askMatchedQty);
        assignMatched(askConsumers, askMatchedQty);

        // 残留仓位加权平均开仓价（步骤4结算价，同时作为下回合现货盘口基准价）
        const residualQty = residualRefs.reduce((s, r) => s + r.quantity, 0);
        const residualEntrySum = residualRefs.reduce((s, r) => s + r.entryPrice * r.quantity, 0);
        const residualAvgEntry = residualQty > 0 ? residualEntrySum / residualQty : 0;
        if (residualAvgEntry > 0) {
          delistResidualAvgEntryByToken[tokenId] = residualAvgEntry;
          residualRefs.forEach(r => { r.closePrice = residualAvgEntry; });
        } else {
          residualRefs.forEach(r => { r.closePrice = r.entryPrice; });
        }

        // 汇总结算计划
        refs.forEach(r => {
          const closePrice = r.closePrice || adlPrice;
          if (r.actor === 'player' && r.playerId) {
            playerClosePrice.set(r.playerId, closePrice);
          } else if (r.actor === 'ai' && r.actorId && r.feature) {
            const key = `${r.actorId}::${r.feature}`;
            const arr = aiClosePrices.get(key) || [];
            arr.push(closePrice);
            aiClosePrices.set(key, arr);
          } else if (r.actor === 'mm' && r.actorId && r.feature) {
            const key = `${r.actorId}::${r.feature}`;
            const arr = mmClosePrices.get(key) || [];
            arr.push(closePrice);
            mmClosePrices.set(key, arr);
          }
        });
      });
    }

  return {
    delistPendingTokenIds: delistPendingTokenIdsThisRound,
    futuresPendingTokenIds: futuresPendingTokenIdsThisRound,
    delistedTokensWithReason,
    newlyPendingDelistTokens,
    delistStateUpdates,
    delistAvgPriceByToken,
    delistResidualAvgEntryByToken,
    newlyPendingListTokens,
    newlyListedTokens,
    listingStateUpdates,
    playerClosePrice,
    aiClosePrices,
    mmClosePrices,
  };
}
