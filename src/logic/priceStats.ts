// 24小时价格统计的纯函数工具（单一事实来源）
// 说明：游戏内 1 回合 = 1 小时，24 小时涨跌幅 = 当前价格相对 24 个回合前价格的涨跌幅。
// 这里同时供「渲染期显示」与「回合结算（热度/观察标签）」使用，避免两处口径不一致。

export interface HourlyPriceRecord {
  hour: number;
  price: number;
}

/**
 * 查找 24 个回合前的参考价格。
 * 规则（与历史实现保持一致）：
 * 1. 优先精确匹配 hour === round - 24；
 * 2. 否则取不晚于目标小时、且最接近目标小时的更早记录；
 * 3. 若目标小时 < 0（开局不足 24 小时）或找不到记录，回退初始价格。
 */
export function findPrice24hAgo(
  hourlyPrices: readonly HourlyPriceRecord[] | undefined | null,
  initialPrice: number,
  round: number
): number {
  const safeInitialPrice = initialPrice > 0.0001 ? initialPrice : 0.0001;
  const targetHour = round - 24;
  if (targetHour < 0) return safeInitialPrice;

  const records = hourlyPrices || [];
  const exact = records.find(h => h.hour === targetHour);
  if (exact) return exact.price > 0 ? exact.price : safeInitialPrice;

  let best: HourlyPriceRecord | null = null;
  for (const record of records) {
    if (record.hour <= targetHour && (!best || record.hour > best.hour)) {
      best = record;
    }
  }
  if (best && best.price > 0) return best.price;
  return safeInitialPrice;
}

/** 计算 24 小时涨跌幅（百分比）。 */
export function compute24hChangePercent(currentPrice: number, price24hAgo: number): number {
  if (!(price24hAgo > 0)) return 0;
  return ((currentPrice - price24hAgo) / price24hAgo) * 100;
}
