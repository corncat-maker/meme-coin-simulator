import type { LiquidityPool, Token } from '../types';

// 【AI 宏观套利·极简物理搬运版】
// 只在每回合末执行一次：按 AMM 目标价计算搬运量，并受 CEX 库存水位线与池子 10% 上限约束。
// 不做吃盘口、不挂限价单、不跨回合提价。

export const ARB_MIN_SPREAD = 0.02;        // 2% 保本底线
export const ARB_MAX_POOL_MOVE_RATIO = 0.10; // 单回合最多搬运池子的 10%
export const ARB_DUST = 1e-9;

export interface AIMacroArbResult {
  token: Token;
  pool: LiquidityPool;
  movedTokenAmount: number; // 正数 = CEX → DEX；负数 = DEX → CEX
  direction: 'toDex' | 'toCex';
  spreadBefore: number;
  spreadAfter: number;
}

/**
 * 计算「CEX 最高可动用额度」水位线：
 * 已被占用的持仓（玩家 cexBalance + AI 交易员持仓 + 做市商持仓）必须留在交易所，
 * 剩余部分才是可以抽走搬运的真实筹码。
 */
export function computeMaxAvailableToExtract(cexReserve: number, occupiedCexReserve: number): number {
  return Math.max(0, (cexReserve || 0) - (occupiedCexReserve || 0));
}

/**
 * 极简版 AI 宏观套利（纯函数）：
 * - DEX 价 > CEX 价 2%：从 CEX 抽代币搬进 DEX 砸盘，严格受水位线 & 10% 池上限约束；
 * - CEX 价 > DEX 价 2%：从 DEX 抽代币回 CEX（不受 CEX 水位线约束，但不能把 DEX 抽干）。
 */
export function processAIMacroArbitrage(
  token: Token,
  cexPrice: number,
  pool: LiquidityPool | null | undefined,
  occupiedCexReserve: number,
): AIMacroArbResult | null {
  if (!pool || !(cexPrice > 0)) return null;
  const x = Math.max(1e-12, pool.tokenReserve);
  const y = Math.max(1e-12, pool.quoteReserve);
  const k = x * y;
  const dexPrice = y / x;
  const spreadBefore = (dexPrice - cexPrice) / cexPrice;
  if (Math.abs(spreadBefore) <= ARB_MIN_SPREAD) return null;

  let cexReserve = Math.max(0, token.cexReserve || 0);

  if (spreadBefore > 0) {
    // ---- DEX 贵：CEX → DEX 砸盘 ----
    const targetX = Math.sqrt(k / Math.max(cexPrice, 1e-12));
    let deltaX = targetX - x;
    const maxAvailableToExtract = computeMaxAvailableToExtract(cexReserve, occupiedCexReserve);
    deltaX = Math.min(deltaX, x * ARB_MAX_POOL_MOVE_RATIO, maxAvailableToExtract);
    if (!(deltaX > ARB_DUST)) return null;

    const newX = x + deltaX;
    const newY = Math.max(0, k / newX);            // 保持恒定乘积
    const deltaY = Math.max(0, y - newY);
    cexReserve -= deltaX;

    const poolAfter: LiquidityPool = {
      ...pool,
      tokenReserve: newX,
      quoteReserve: newY,
      k: newX * newY,
      lastPrice: newY / newX,
    };
    const spreadAfter = (poolAfter.quoteReserve / poolAfter.tokenReserve - cexPrice) / cexPrice;
    return {
      token: { ...token, cexReserve, dexReserve: newX },
      pool: poolAfter,
      movedTokenAmount: deltaX,
      direction: 'toDex',
      spreadBefore,
      spreadAfter,
    };
  }

  // ---- CEX 贵：DEX → CEX 抽币 ----
  const targetX = Math.sqrt(k / Math.max(cexPrice, 1e-12));
  let deltaX = x - targetX;
  // 不能把 DEX 抽干：最多池子的 10%，且保留极小残量
  const dexKeepFloor = Math.max(1e-9, x * 1e-6);
  deltaX = Math.min(deltaX, x * ARB_MAX_POOL_MOVE_RATIO, Math.max(0, x - dexKeepFloor));
  if (!(deltaX > ARB_DUST)) return null;

  const newX = Math.max(1e-12, x - deltaX);
  const newY = Math.max(0, k / newX);              // 保持恒定乘积（CEX 侧支付 USDT）
  cexReserve += deltaX;

  const poolAfter: LiquidityPool = {
    ...pool,
    tokenReserve: newX,
    quoteReserve: newY,
    k: newX * newY,
    lastPrice: newY / newX,
  };
  const spreadAfter = (poolAfter.quoteReserve / poolAfter.tokenReserve - cexPrice) / cexPrice;
  return {
    token: { ...token, cexReserve, dexReserve: newX },
    pool: poolAfter,
    movedTokenAmount: -deltaX,
    direction: 'toCex',
    spreadBefore,
    spreadAfter,
  };
}

// ==================== 域四-1：回合级套利聚合（纯函数） ====================
// 从 src/App.tsx 的 AI 宏观套利 effect 中机械抽出：只负责计算本回合的库存增量与池子更新，
// 不触碰任何 React 状态；幂等守卫、增量合并 setState、DEV 调试仍留在 App 侧。

import type { AITrader, AIMarketMaker } from '../types';

export interface AIMacroArbRoundDelta {
  cexDelta: number;
  dexDelta: number;
}

export interface AIMacroArbDebugEntry {
  code: string;
  direction: 'toDex' | 'toCex';
  moved: number;
  spreadBefore: number;
  spreadAfter: number;
}

export interface AIMacroArbRoundInput {
  tokens: Token[];
  liquidityPools: Record<string, LiquidityPool>;
  lastPriceOf: (tokenId: string) => number;
  playerCexBalances: Record<string, number>;
  aiTraders: AITrader[];
  aiMarketMakers: AIMarketMaker[];
  /** 本回合被手动空投改动的代币：不参与套利搬运（沿用旧行为） */
  skipTokenIds?: ReadonlySet<string>;
}

export interface AIMacroArbRoundResult {
  tokenDeltas: Record<string, AIMacroArbRoundDelta>;
  poolUpdates: Record<string, LiquidityPool>;
  debugLog: AIMacroArbDebugEntry[];
  warnings: string[];
}

export function computeAIMacroArbitrageRound(input: AIMacroArbRoundInput): AIMacroArbRoundResult {
  const { tokens, liquidityPools, lastPriceOf, playerCexBalances, aiTraders, aiMarketMakers, skipTokenIds } = input;

  const tokenDeltas: Record<string, AIMacroArbRoundDelta> = {};
  const poolUpdates: Record<string, LiquidityPool> = {};
  const debugLog: AIMacroArbDebugEntry[] = [];
  const warnings: string[] = [];

  // 已占用 CEX 库存 = 玩家交易所余额 + 所有 AI 交易员持仓 + 所有做市商持仓
  const aiHoldingsForArb: Record<string, number> = {};
  aiTraders.forEach(trader => {
    trader.positions.forEach(p => { aiHoldingsForArb[p.tokenId] = (aiHoldingsForArb[p.tokenId] || 0) + p.quantity; });
  });
  const mmHoldingsForArb: Record<string, number> = {};
  aiMarketMakers.forEach(mm => {
    mm.positions.forEach(p => { mmHoldingsForArb[p.tokenId] = (mmHoldingsForArb[p.tokenId] || 0) + p.quantity; });
  });
  const occupiedFor = (tokenId: string) =>
    (playerCexBalances[tokenId] || 0) + (aiHoldingsForArb[tokenId] || 0) + (mmHoldingsForArb[tokenId] || 0);

  tokens.forEach(token => {
    // 【修复】玩家本回合主动空投的代币不参与宏观套利搬运（避免被误判为“空投扣库存”）
    if (skipTokenIds && skipTokenIds.has(token.id)) return;
    const pool = liquidityPools[token.id];
    if (!pool) return;
    const cexPrice = lastPriceOf(token.id);
    const result = processAIMacroArbitrage(token, cexPrice, pool, occupiedFor(token.id));
    if (!result) return;
    // 【修复】只记录库存增量，应用时按增量合并到最新 state，避免覆盖同回合其它流程（如充提币结算）对库存的修改
    tokenDeltas[token.id] = {
      cexDelta: (result.token.cexReserve || 0) - (token.cexReserve || 0),
      dexDelta: (result.token.dexReserve || 0) - (token.dexReserve || 0),
    };
    poolUpdates[token.id] = result.pool;
    debugLog.push({
      code: token.code, direction: result.direction, moved: result.movedTokenAmount,
      spreadBefore: result.spreadBefore, spreadAfter: result.spreadAfter,
    });
  });

  // ===== 兜底检查：库存不得低于已占用持仓 =====
  // 【修复】不在这里强行抬高库存（会凭空造币）；只记录异常，交由守恒自检 effect 收缩超额持仓
  tokens.forEach(token => {
    const snapshotReserve = token.cexReserve || 0;
    const occupied = occupiedFor(token.id);
    if (snapshotReserve + 1e-6 < occupied) {
      warnings.push(`【库存异常】${token.code} 库存(${snapshotReserve.toFixed(4)})低于持仓(${occupied.toFixed(4)})，将由守恒自检收缩超额持仓！`);
    }
  });

  return { tokenDeltas, poolUpdates, debugLog, warnings };
}
