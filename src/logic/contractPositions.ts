import type { AIFuturesPosition, FuturesPosition, RetailPosition } from '../types';

/** 图表记录 v2：数量=代币数，价值=开仓 USDT 名义金额。 */
export interface ContractPositionHistoryPoint {
  round: number;
  tokenId: string;
  totalLongQuantity: number;
  totalShortQuantity: number;
  totalLongValue: number;
  totalShortValue: number;
  avgPrice: number;
  unitsVersion?: 2;
}

/**
 * 仅汇总持仓，不产生交易或修改仓位。
 * 散户 quantity 存的是开仓 USDT 名义金额，必须逐仓除以各自 entryPrice；
 * 玩家和 AI quantity 已经是代币数量，不能再除价格或重复乘价格。
 * 多空分别保留，图表仍沿用多空总敞口口径（不是交易所单边 OI）。
 */
export function summarizeContractPositions(
  playerPositions: readonly FuturesPosition[],
  retailPositions: readonly RetailPosition[],
  aiPositions: readonly AIFuturesPosition[],
  marketMakerPositions: readonly AIFuturesPosition[],
): Pick<ContractPositionHistoryPoint, 'totalLongQuantity' | 'totalShortQuantity' | 'totalLongValue' | 'totalShortValue'> {
  const totals = {
    totalLongQuantity: 0,
    totalShortQuantity: 0,
    totalLongValue: 0,
    totalShortValue: 0,
  };
  const add = (side: 'long' | 'short', quantity: number, value: number) => {
    if (side === 'long') {
      totals.totalLongQuantity += quantity;
      totals.totalLongValue += value;
    } else {
      totals.totalShortQuantity += quantity;
      totals.totalShortValue += value;
    }
  };
  playerPositions.forEach(p => add(p.side, p.quantity, p.value || p.quantity * p.entryPrice));
  retailPositions.forEach(p => add(p.side, p.entryPrice > 0 ? p.quantity / p.entryPrice : 0, p.quantity));
  aiPositions.forEach(p => add(p.side, p.quantity, p.quantity * p.entryPrice));
  marketMakerPositions.forEach(p => add(p.side, p.quantity, p.quantity * p.entryPrice));
  return totals;
}

/**
 * 旧版历史已经把 USDT 乘过价格，缺少逐仓数据，无法可靠逆算。
 * 只丢弃无版本标记的失真图表缓存；真实仓位、资金、成交和其他历史不变。
 */
export function restoreContractPositionHistory(
  history: readonly ContractPositionHistoryPoint[] | undefined,
): ContractPositionHistoryPoint[] {
  return Array.isArray(history) ? history.filter(point => point.unitsVersion === 2) : [];
}
