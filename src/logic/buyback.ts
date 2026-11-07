// 域四-4：回合内回购销毁（纯函数）
// 从 src/App.tsx 的「项目资金池回购销毁 + 每 24 回合收益回购销毁」机械搬迁：
// 只计算盘口吃单结果、销毁数据与文案，不修改入参盘口、不 setState、不 showToast。
import type { Candle, Level2OrderBook, OrderBookEntry, Token } from '../types';
import { formatNumber } from '../utils/format';
import { compute24hTurnover } from './volume';

export interface TokenBurnUpdate {
  tokenId: string;
  burnQuantity: number;
  spentAmount: number;
  remainingBudget: number;
  type: 'project_pool' | 'revenue';
  newProjectFundPool?: number;
  volumeSinceLastClaim?: number;
  lastClaimRound?: number;
  burnRatio?: number;
  tokenCurrentPrice?: number;
  tokenCirculatingSupply?: number;
}

export interface BuybackBurnToast {
  message: string;
  type: 'success';
}

export interface BuybackBurnInput {
  round: number;
  /** 已更新 volumeSinceLastClaim 的本回合代币数组（只读） */
  tokens: Token[];
  /** 本回合现货盘口更新（只读；返回值里只回传变化项） */
  books: Record<string, Level2OrderBook>;
  /** 本回合新生成的 K 线（优先读取） */
  candlesUpdates: Record<string, Candle[]>;
  /** 状态中的 K 线（回退读取） */
  candlesState: Record<string, Candle[]>;
}

export interface BuybackBurnResult {
  bookUpdates: Record<string, Level2OrderBook>;
  burnUpdates: TokenBurnUpdate[];
  toasts: BuybackBurnToast[];
}

interface BuyAsksResult {
  book: Level2OrderBook;
  totalBoughtQuantity: number;
  totalSpent: number;
  remainingBudget: number;
}

/** 从卖盘按价格从低到高市价买入（逐字保留旧实现的吃单与「未吃掉卖单」保留规则） */
function buyFromAsks(book: Level2OrderBook, budget: number): BuyAsksResult {
  let remainingBudget = budget;
  let totalBoughtQuantity = 0;
  let totalSpent = 0;
  const newAsks: OrderBookEntry[] = [];

  for (const ask of book.asks) {
    if (remainingBudget <= 0) break;

    const askTotalCost = ask.price * ask.quantity;
    if (askTotalCost <= remainingBudget) {
      // 完全吃掉这个卖单
      totalBoughtQuantity += ask.quantity;
      totalSpent += askTotalCost;
      remainingBudget -= askTotalCost;
    } else {
      // 部分吃掉这个卖单
      const buyQuantity = remainingBudget / ask.price;
      totalBoughtQuantity += buyQuantity;
      totalSpent += remainingBudget;
      newAsks.push({
        ...ask,
        quantity: ask.quantity - buyQuantity,
        total: (ask.quantity - buyQuantity) * ask.price,
      });
      remainingBudget = 0;
    }
  }

  // 保留未吃掉的卖单
  for (const ask of book.asks) {
    const processed = newAsks.find(a => a.price === ask.price);
    if (!processed && ask.price * ask.quantity > 0) {
      newAsks.push(ask);
    }
  }

  const sortedAsks = newAsks.sort((a, b) => a.price - b.price);
  return {
    book: {
      ...book,
      asks: sortedAsks,
      totalAskQuantity: sortedAsks.reduce((sum, a) => sum + a.quantity, 0),
    },
    totalBoughtQuantity,
    totalSpent,
    remainingBudget,
  };
}

export function computeBuybackBurns(input: BuybackBurnInput): BuybackBurnResult {
  const { round, tokens, books, candlesUpdates, candlesState } = input;

  // 工作副本：模拟旧实现「先改盘口对象、后续流程读已改后的盘口」的可见性，但不触碰入参
  const workingBooks: Record<string, Level2OrderBook | undefined> = { ...books };
  const bookUpdates: Record<string, Level2OrderBook> = {};
  const burnUpdates: TokenBurnUpdate[] = [];
  const toasts: BuybackBurnToast[] = [];

  // ===== 每回合：项目资金池 1% 市价回购并销毁 =====
  tokens.forEach(token => {
    if (!token.isPlayerCreated || !token.autoBurnRevenue) return;

    const projectFundPool = token.projectFundPool || 0;
    if (projectFundPool > 0) {
      const buyBudget = projectFundPool * 0.01;
      if (buyBudget < 1) return; // 资金太少，跳过

      const spotBook = workingBooks[token.id];
      if (!spotBook || spotBook.asks.length === 0) return;

      const filled = buyFromAsks(spotBook, buyBudget);
      if (filled.totalBoughtQuantity > 0) {
        workingBooks[token.id] = filled.book;
        bookUpdates[token.id] = filled.book;
        burnUpdates.push({
          tokenId: token.id,
          burnQuantity: filled.totalBoughtQuantity,
          spentAmount: filled.totalSpent,
          remainingBudget: filled.remainingBudget,
          type: 'project_pool',
        });
        toasts.push({
          message: `🔥 ${token.code} 项目资金池回购：$${formatNumber(filled.totalSpent, 0)} → 销毁 ${formatNumber(filled.totalBoughtQuantity, 0)} 枚`,
          type: 'success',
        });
      }
    }
  });

  // ===== 每 24 回合：CEX 收益回购销毁 =====
  if (round % 24 === 0) {
    tokens.forEach(token => {
      if (!token.isPlayerCreated || !token.autoBurnRevenue) return;

      const lastClaim = token.lastClaimRound || token.createdAt || 0;
      const roundsSinceLastClaim = round - lastClaim;
      if (roundsSinceLastClaim < 24) return;

      // 使用最近 24 根 K 线的成交量
      const tokenCandles = candlesUpdates[token.id] || candlesState[token.id] || [];
      const last24Candles = tokenCandles.slice(-24);
      // 24h 成交额 = 最近 24 回合「成交量 × VWAP」直接求和（与运营收益口径一致）
      const lastCandle = tokenCandles[tokenCandles.length - 1];
      const currentPrice = lastCandle ? lastCandle.close : token.currentPrice;
      const volume24hValue = compute24hTurnover(last24Candles);

      // 根据代币类型计算收益：meme 0.1%，智能合约 0.3%，公链 0.5%
      let revenueRate = 0.001;
      if (token.tokenType === 'smart_contract') {
        revenueRate = 0.003;
      } else if (token.tokenType === 'blockchain') {
        revenueRate = 0.005;
      }
      const totalRevenue = volume24hValue * revenueRate;
      if (totalRevenue <= 0) return;

      const currentProjectFundPool = token.projectFundPool || 0;
      const spotBook = workingBooks[token.id];

      if (spotBook && spotBook.asks.length > 0) {
        const filled = buyFromAsks(spotBook, totalRevenue);
        if (filled.totalBoughtQuantity > 0) {
          workingBooks[token.id] = filled.book;
          bookUpdates[token.id] = filled.book;

          const burnRatio = filled.totalBoughtQuantity / token.circulatingSupply;
          const newProjectFundPool = currentProjectFundPool + filled.remainingBudget;

          burnUpdates.push({
            tokenId: token.id,
            burnQuantity: filled.totalBoughtQuantity,
            spentAmount: filled.totalSpent,
            remainingBudget: filled.remainingBudget,
            type: 'revenue',
            newProjectFundPool,
            volumeSinceLastClaim: 0,
            lastClaimRound: round,
            burnRatio,
            tokenCurrentPrice: token.currentPrice,
            tokenCirculatingSupply: token.circulatingSupply,
          });

          if (filled.remainingBudget > 0) {
            toasts.push({
              message: `💰 ${token.code} CEX收益回购：$${formatNumber(filled.totalSpent, 0)} → 销毁 ${formatNumber(filled.totalBoughtQuantity, 0)} 枚，余$${formatNumber(filled.remainingBudget, 0)}存入项目资金池`,
              type: 'success',
            });
          } else {
            toasts.push({
              message: `💰 ${token.code} CEX收益回购：$${formatNumber(filled.totalSpent, 0)} → 销毁 ${formatNumber(filled.totalBoughtQuantity, 0)} 枚`,
              type: 'success',
            });
          }
        } else {
          // 盘口深度不足，全部资金进入项目资金池
          burnUpdates.push({
            tokenId: token.id,
            burnQuantity: 0,
            spentAmount: 0,
            remainingBudget: 0,
            type: 'revenue',
            newProjectFundPool: currentProjectFundPool + totalRevenue,
            volumeSinceLastClaim: 0,
            lastClaimRound: round,
          });
          toasts.push({
            message: `💰 ${token.code} 收益$${formatNumber(totalRevenue, 0)}进入项目资金池（CEX盘口深度不足）`,
            type: 'success',
          });
        }
      } else {
        // 无 CEX 盘口，资金进入项目资金池
        burnUpdates.push({
          tokenId: token.id,
          burnQuantity: 0,
          spentAmount: 0,
          remainingBudget: 0,
          type: 'revenue',
          newProjectFundPool: currentProjectFundPool + totalRevenue,
          volumeSinceLastClaim: 0,
          lastClaimRound: round,
        });
        toasts.push({
          message: `💰 ${token.code} 收益$${formatNumber(totalRevenue, 0)}进入项目资金池（无CEX盘口）`,
          type: 'success',
        });
      }
    });
  }

  return { bookUpdates, burnUpdates, toasts };
}
