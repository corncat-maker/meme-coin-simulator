/**
 * 旧存档兼容迁移
 *
 * 背景：v3.4 之前的版本存在「合约 OI 强制轧差」机制，会在每回合末向散户持仓中
 * 注入 id 以 `oi-bal-` 开头的虚拟对手仓，把多空持仓价值强行校准为 1:1。
 * 该机制已在域三-4 彻底移除（见 fastForward.generateRetailBySentiment 注释）。
 *
 * 风险：若直接读取旧存档，这些虚拟仓会被当作真实散户仓长期留在市场里，
 * 导致盘口/多空比失真。因此只在「读档」这一处做一次性过滤。
 *
 * 说明：游戏运行过程中不会有任何代码再产生或识别该前缀，
 *      此常量仅用于识别旧版本遗留数据。
 */

/** 旧版本 OI 强制轧差虚拟仓的 id 前缀 */
export const LEGACY_OI_BAL_PREFIX = 'oi-bal-';

/**
 * 过滤旧存档中的 OI 轧差虚拟散户仓。
 * 无遗留数据时原样返回（保持引用不变，避免不必要的重渲染）。
 */
export function stripLegacyOiBalancePositions<T extends { id: string }>(positions: T[]): T[] {
  if (!Array.isArray(positions) || positions.length === 0) return positions;
  const hasLegacy = positions.some(p => typeof p?.id === 'string' && p.id.startsWith(LEGACY_OI_BAL_PREFIX));
  if (!hasLegacy) return positions;
  const kept = positions.filter(p => !(typeof p?.id === 'string' && p.id.startsWith(LEGACY_OI_BAL_PREFIX)));
  console.info(`[migration] 已清理旧版 OI 轧差虚拟仓 ${positions.length - kept.length} 个`);
  return kept;
}
