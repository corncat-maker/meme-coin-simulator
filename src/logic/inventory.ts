// ============ 宏观物理库存池：CEX / DEX / 玩家钱包 ============
// 第二阶段基础设施：只负责数据结构、初始分配与旧存档迁移，不参与任何价格/盘口/结算公式。
// 设计原则：不为单个 AI 维护钱包，只维护代币级的宏观库存（cexReserve / dexReserve）。
import type { PlayerTokenBalance, Position, Token } from '../types';

/**
 * 初始分配比例：
 * - 巨鲸 / 大盘代币（tier >= 4）：CEX 60% / DEX 40%
 * - 中型及以下代币（tier <= 3，含 Meme / 微盘）：CEX 80% / DEX 20%
 */
export function getInventoryRatios(tier: number): { cexRatio: number; dexRatio: number } {
  return tier >= 4 ? { cexRatio: 0.6, dexRatio: 0.4 } : { cexRatio: 0.8, dexRatio: 0.2 };
}

/**
 * 按流通量初始化代币的两类物理库存。
 * 总量守恒：cexReserve + dexReserve === circulatingSupply。
 */
export function initializeTokenReserves(
  circulatingSupply: number,
  tier: number
): { cexReserve: number; dexReserve: number } {
  const supply = Number.isFinite(circulatingSupply) ? Math.max(0, circulatingSupply) : 0;
  const { cexRatio, dexRatio } = getInventoryRatios(tier);
  return { cexReserve: supply * cexRatio, dexReserve: supply * dexRatio };
}

export function createEmptyPlayerTokenBalance(): PlayerTokenBalance {
  return { cexBalance: 0, walletBalance: 0, pendingCex: 0, pendingWallet: 0 };
}

/** 新开局：为每个代币建立全零的玩家资产记录（结构显式存在，便于后续 UI 直接读取）。 */
export function createInitialPlayerTokenBalances(tokens: Token[]): Record<string, PlayerTokenBalance> {
  const balances: Record<string, PlayerTokenBalance> = {};
  for (const token of tokens) balances[token.id] = createEmptyPlayerTokenBalance();
  return balances;
}

/** 旧存档兼容：把现货持仓迁移成 CEX 余额（钱包/在途资金清零）。 */
export function migratePlayerTokenBalancesFromPositions(
  positions: Position[],
  tokens: Token[]
): Record<string, PlayerTokenBalance> {
  const balances = createInitialPlayerTokenBalances(tokens);
  for (const position of positions) {
    if (position.isLpToken) continue;
    const entry = balances[position.tokenId] || createEmptyPlayerTokenBalance();
    entry.cexBalance = Math.max(0, position.quantity);
    balances[position.tokenId] = entry;
  }
  return balances;
}

/**
 * ⚠️ 仅用于旧存档迁移/初始化的一次性对齐，禁止在 positions 变化时调用。
 * cexBalance 是玩家在交易所的"现货可用余额"，与 Position（仓位/持仓）是两套账本：
 * 买卖结算、充提币等路径必须显式维护 cexBalance，绝不能由持仓强制覆盖。
 */
export function reconcileCexBalances(
  balances: Record<string, PlayerTokenBalance>,
  positions: Position[]
): Record<string, PlayerTokenBalance> {
  const next: Record<string, PlayerTokenBalance> = { ...balances };
  for (const position of positions) {
    if (position.isLpToken) continue;
    const entry = next[position.tokenId] || createEmptyPlayerTokenBalance();
    next[position.tokenId] = { ...entry, cexBalance: Math.max(0, position.quantity) };
  }
  return next;
}

/**
 * 【库存守恒】市场可挂卖的真实可用库存 = cexReserve − 玩家 cexBalance − AI 持仓 − 做市商持仓。
 * 玩家自己的挂单卖单由其 cexBalance 支撑，不占用该额度。
 */
export function computeAvailableAskLiquidity(
  cexReserve: number,
  playerCexBalance: number,
  aiHoldingQuantity: number,
  marketMakerHoldingQuantity: number
): number {
  const reserve = Number.isFinite(cexReserve) ? cexReserve : 0;
  const player = Number.isFinite(playerCexBalance) ? Math.max(0, playerCexBalance) : 0;
  const ai = Number.isFinite(aiHoldingQuantity) ? Math.max(0, aiHoldingQuantity) : 0;
  const mm = Number.isFinite(marketMakerHoldingQuantity) ? Math.max(0, marketMakerHoldingQuantity) : 0;
  return Math.max(0, reserve - player - ai - mm);
}

export interface ReserveConservationResult {
  ok: boolean;
  cexReserve: number;
  accounted: number;
  diff: number;
}

/** 【库存守恒自检】cexReserve 必须 ≥ 玩家 cexBalance + AI 持仓 + 做市商持仓。 */
export function checkReserveConservation(
  cexReserve: number,
  playerCexBalance: number,
  aiHoldingQuantity: number,
  marketMakerHoldingQuantity: number
): ReserveConservationResult {
  const reserve = Number.isFinite(cexReserve) ? cexReserve : 0;
  const accounted =
    (Number.isFinite(playerCexBalance) ? Math.max(0, playerCexBalance) : 0) +
    (Number.isFinite(aiHoldingQuantity) ? Math.max(0, aiHoldingQuantity) : 0) +
    (Number.isFinite(marketMakerHoldingQuantity) ? Math.max(0, marketMakerHoldingQuantity) : 0);
  const diff = reserve - accounted;
  return { ok: diff >= -1e-6, cexReserve: reserve, accounted, diff };
}
