/**
 * 只读派生数据 Store（Stage 3 · 第一批次）
 *
 * 设计原则（务必遵守）：
 * 1. 这里只放「由其他状态计算得出」的只读聚合数据，绝不放可被业务直接修改的源头状态。
 * 2. 计算函数是纯函数，输入输出与 App.tsx 内原有内联表达式 **逐字等价**，
 *    保证任何一次迁移都不会让数值产生偏移。
 * 3. App 侧仍然保留原有 useState；本 store 只做「镜像 + 统一出口」，
 *    组件可以订阅它，从而避免在 App 内部重复做同一份 reduce/filter。
 */
import { createStore } from 'zustand/vanilla';
import { useSyncExternalStore } from 'react';
import type { Token, Position, FuturesPosition, PlayerTokenBalance, PendingTransfer } from '../types';

/** 市场聚合（全部代币级别的只读统计） */
export interface MarketAggregate {
  tokenCount: number;
  /** 全网总市值 */
  totalMarketCap: number;
  /** 平均 24h 涨跌幅（%） */
  avgChange24h: number;
  /** 上涨 / 下跌 / 平盘 家数 */
  upCount: number;
  downCount: number;
  flatCount: number;
  /** 总流通量 */
  totalCirculatingSupply: number;
}

/** 资产聚合（净资产口径与资金分布，公式与 App 内联表达式逐字等价） */
export interface PortfolioAggregate {
  /** 现金 + 冻结（毛资产口径中的现金部分） */
  cashTotal: number;
  /** 毛资产 = totalAsset + 待还债务（资金分布分母） */
  grossAssets: number;
  /** 持仓市值（可用资金页卡片同款公式） */
  positionValue: number;
  /** 资金分布：可用 / 冻结 / 持仓 占比（%，已做 NaN → 0） */
  availablePct: number;
  frozenPct: number;
  positionPct: number;
  /** 现货持仓数 / 合约持仓数 */
  spotPositionCount: number;
  futuresPositionCount: number;
  /** 现货持仓市值合计（按 latestPrice 兜底 currentPrice） */
  spotPositionValue: number;
  /** 合约未实现盈亏合计 */
  futuresUnrealizedPnl: number;
}

/** 库存聚合（CEX / DEX 物理库存水位） */
export interface InventoryAggregate {
  totalCexReserve: number;
  totalDexReserve: number;
  /** 玩家在 CEX 的代币余额合计 */
  totalPlayerCexBalance: number;
  /** 玩家链上钱包代币数量合计（不含 USDT） */
  totalPlayerWalletBalance: number;
  /** 在途（充值/提币）数量合计 */
  totalPendingAmount: number;
  /** CEX 库存偏薄（< 流通量 1%）的代币数量 */
  thinCexReserveCount: number;
  /** 零库存代币数量 */
  emptyCexReserveCount: number;
}

const EMPTY_MARKET: MarketAggregate = {
  tokenCount: 0, totalMarketCap: 0, avgChange24h: 0,
  upCount: 0, downCount: 0, flatCount: 0, totalCirculatingSupply: 0,
};
const EMPTY_PORTFOLIO: PortfolioAggregate = {
  cashTotal: 0, grossAssets: 1, positionValue: 0,
  availablePct: 0, frozenPct: 0, positionPct: 0,
  spotPositionCount: 0, futuresPositionCount: 0, spotPositionValue: 0, futuresUnrealizedPnl: 0,
};
const EMPTY_INVENTORY: InventoryAggregate = {
  totalCexReserve: 0, totalDexReserve: 0, totalPlayerCexBalance: 0,
  totalPlayerWalletBalance: 0, totalPendingAmount: 0,
  thinCexReserveCount: 0, emptyCexReserveCount: 0,
};

/** 市场聚合：纯函数，无副作用 */
export function computeMarketAggregate(tokens: Token[]): MarketAggregate {
  if (tokens.length === 0) return EMPTY_MARKET;
  let totalMarketCap = 0;
  let changeSum = 0;
  let upCount = 0;
  let downCount = 0;
  let flatCount = 0;
  let totalCirculatingSupply = 0;
  for (const t of tokens) {
    totalMarketCap += t.marketCap || 0;
    changeSum += t.change24h || 0;
    totalCirculatingSupply += t.circulatingSupply || 0;
    const c = t.change24h || 0;
    if (c > 0) upCount += 1;
    else if (c < 0) downCount += 1;
    else flatCount += 1;
  }
  return {
    tokenCount: tokens.length,
    totalMarketCap,
    avgChange24h: changeSum / tokens.length,
    upCount, downCount, flatCount,
    totalCirculatingSupply,
  };
}

/** 资产聚合：公式与 App.tsx 内联表达式逐字等价 */
export function computePortfolioAggregate(input: {
  totalAsset: number;
  availableCapital: number;
  frozenCapital: number;
  loanDebt: number;
  totalCollateralValue: number;
  positions: Position[];
  futuresPositions: FuturesPosition[];
  tokens: Token[];
}): PortfolioAggregate {
  const {
    totalAsset, availableCapital, frozenCapital,
    loanDebt, totalCollateralValue, positions, futuresPositions, tokens,
  } = input;

  // 与 App 中 `const grossAssets = Math.max(1, totalAsset + loanSummary.totalDebt);` 一致
  const grossAssets = Math.max(1, totalAsset + loanDebt);

  // 与可用资金页「持仓市值」卡片一致
  const positionValue = Math.max(0, totalAsset - availableCapital - frozenCapital + loanDebt);

  // 与资金分布三段式一致（含 `|| 0` 的 NaN 兜底）
  const availablePct = (availableCapital / grossAssets * 100) || 0;
  const frozenPct = (frozenCapital / grossAssets * 100) || 0;
  const positionPct = Math.max(0, ((grossAssets - availableCapital - frozenCapital - totalCollateralValue) / grossAssets * 100)) || 0;

  let spotPositionValue = 0;
  for (const pos of positions) {
    spotPositionValue += pos.marketValue || 0;
  }
  let futuresUnrealizedPnl = 0;
  for (const fp of futuresPositions) {
    futuresUnrealizedPnl += fp.unrealizedPnl || 0;
  }

  return {
    cashTotal: availableCapital + frozenCapital,
    grossAssets,
    positionValue,
    availablePct, frozenPct, positionPct,
    spotPositionCount: positions.length,
    futuresPositionCount: futuresPositions.length,
    spotPositionValue,
    futuresUnrealizedPnl,
  };
}

/** 库存聚合：纯函数，无副作用 */
export function computeInventoryAggregate(input: {
  tokens: Token[];
  playerTokenBalances: Record<string, PlayerTokenBalance>;
  pendingTransfers: PendingTransfer[];
}): InventoryAggregate {
  const { tokens, playerTokenBalances, pendingTransfers } = input;
  let totalCexReserve = 0;
  let totalDexReserve = 0;
  let thinCexReserveCount = 0;
  let emptyCexReserveCount = 0;
  for (const t of tokens) {
    const cex = t.cexReserve || 0;
    totalCexReserve += cex;
    totalDexReserve += t.dexReserve || 0;
    if (cex <= 0) emptyCexReserveCount += 1;
    else if (cex < (t.circulatingSupply || 0) * 0.01) thinCexReserveCount += 1;
  }
  let totalPlayerCexBalance = 0;
  let totalPlayerWalletBalance = 0;
  for (const tokenId of Object.keys(playerTokenBalances)) {
    const b = playerTokenBalances[tokenId];
    if (!b) continue;
    totalPlayerCexBalance += b.cexBalance || 0;
    totalPlayerWalletBalance += b.walletBalance || 0;
  }
  let totalPendingAmount = 0;
  for (const p of pendingTransfers) {
    totalPendingAmount += p.amount || 0;
  }
  return {
    totalCexReserve, totalDexReserve,
    totalPlayerCexBalance, totalPlayerWalletBalance, totalPendingAmount,
    thinCexReserveCount, emptyCexReserveCount,
  };
}

interface DerivedState {
  market: MarketAggregate;
  portfolio: PortfolioAggregate;
  inventory: InventoryAggregate;
  /** 是否至少完成过一次同步（用于避免首帧读到空值） */
  hydrated: boolean;
  setMarket: (v: MarketAggregate) => void;
  setPortfolio: (v: PortfolioAggregate) => void;
  setInventory: (v: InventoryAggregate) => void;
}

export const derivedStore = createStore<DerivedState>((set) => ({
  market: EMPTY_MARKET,
  portfolio: EMPTY_PORTFOLIO,
  inventory: EMPTY_INVENTORY,
  hydrated: false,
  setMarket: (market) => set({ market, hydrated: true }),
  setPortfolio: (portfolio) => set({ portfolio, hydrated: true }),
  setInventory: (inventory) => set({ inventory, hydrated: true }),
}));

/**
 * React 绑定：直接用 React 自带的 useSyncExternalStore 订阅 zustand vanilla store。
 * 原因：本项目曾出现 zustand 预打包的 React 副本导致 "Invalid hook call /
 * Cannot read properties of null (reading 'useCallback')"，改用 vanilla store + 同源 React，
 * 既保留 zustand 的 store 语义（getState/setState/subscribe），又避免多份 React。
 */
export function useDerivedSelector<T>(selector: (s: DerivedState) => T): T {
  return useSyncExternalStore(
    derivedStore.subscribe,
    () => selector(derivedStore.getState()),
    () => selector(derivedStore.getState()),
  );
}

/** 选择器：避免组件订阅整个 store 造成无关重渲染 */
export const selectMarket = (s: DerivedState) => s.market;
export const selectPortfolio = (s: DerivedState) => s.portfolio;
export const selectInventory = (s: DerivedState) => s.inventory;
export const selectHydrated = (s: DerivedState) => s.hydrated;
