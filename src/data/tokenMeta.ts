// 从 src/App.tsx 机械搬迁（Stage 1），逻辑未改动。
import { SUDDEN_EVENTS } from '../constants/events';
import type { Token } from '../types';

export function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

// ============ 热度地图归一化（兼容旧存档/旧快照） ============
// 热度上限机制：每代币独立热度上限（默认100，最高500，最低100）
// fullStreak：连续满热度回合计数；zeroStreak：连续零热度回合计数
export function normalizeHeatMapEntry(entry: { heat?: number; duration?: number; cap?: number; fullStreak?: number; zeroStreak?: number } | undefined | null) {
  const e = entry ?? {};
  return {
    heat: typeof e.heat === 'number' && isFinite(e.heat) ? e.heat : 0,
    duration: typeof e.duration === 'number' && isFinite(e.duration) ? e.duration : 0,
    cap: typeof e.cap === 'number' && isFinite(e.cap) ? Math.min(500, Math.max(100, Math.round(e.cap))) : 100,
    fullStreak: typeof e.fullStreak === 'number' && isFinite(e.fullStreak) ? Math.max(0, Math.floor(e.fullStreak)) : 0,
    zeroStreak: typeof e.zeroStreak === 'number' && isFinite(e.zeroStreak) ? Math.max(0, Math.floor(e.zeroStreak)) : 0,
  };
}

export function normalizeHeatMap(map: Record<string, { heat?: number; duration?: number; cap?: number; fullStreak?: number; zeroStreak?: number }> | undefined | null) {
  const result: Record<string, { heat: number; duration: number; cap: number; fullStreak: number; zeroStreak: number }> = {};
  if (map && typeof map === 'object') {
    Object.keys(map).forEach(k => {
      result[k] = normalizeHeatMapEntry(map[k]);
    });
  }
  return result;
}

// ============ 代币tier动态计算 ============
// 【动态tier机制】tier根据当前有效市值（当前价格 × 流通供应量）随时切换，而非永久固定
// 注意：使用有效市值（currentPrice * circulatingSupply），不使用FDV（价格 × 总供应量）
export function calculateTierFromMarketCap(effectiveMarketCap: number): number {
  if (effectiveMarketCap >= 10000000000) return 6; // 巨鲸：有效市值 >= 100亿
  if (effectiveMarketCap >= 5000000000) return 5;  // 巨型：有效市值 >= 50亿
  if (effectiveMarketCap >= 1000000000) return 4;  // 大型：有效市值 >= 10亿
  if (effectiveMarketCap >= 100000000) return 3;   // 中型：有效市值 >= 1亿
  if (effectiveMarketCap >= 10000000) return 2;    // 小型：有效市值 >= 1000万
  return 1;                                        // 微型
}

// 根据代币当前有效市值动态计算tier
export function getTokenTier(token: Token): number {
  if (!token) return 1;
  const price = typeof token.currentPrice === 'number' && isFinite(token.currentPrice) ? token.currentPrice : 0;
  const supply = typeof token.circulatingSupply === 'number' && isFinite(token.circulatingSupply) ? token.circulatingSupply : 0;
  return calculateTierFromMarketCap(price * supply);
}

// ============ 观察标签机制辅助函数 ============
// 判断代币是否处于观察标签状态（当前回合小于观察结束回合）
export function isTokenWatched(token: Token, currentRound: number): boolean {
  return token.watchEndRound !== undefined && token.watchEndRound !== null && token.watchEndRound > currentRound;
}
// 观察标签代币的机制tier：各种波动率/事件相关机制与微型代币(1)一致
export function getMechanicsTier(token: Token): number {
  if (token.watchEndRound !== undefined && token.watchEndRound !== null && token.watchEndRound > 0) return 1;
  return getTokenTier(token);
}
// ============ K线高低价浮动范围（按代币tier） ============
// 初始化K线与每回合新K线共用同一套高低价浮动幅度，保证所有K线表现一致
// 巨鲸（≥100亿）：0.01%-0.15%；巨型（≥50亿）：0.05%-0.3%；大型（≥10亿）：0.1%-0.5%
// 中型（≥1亿）：0.2%-1%；小型（≥1000万）：0.5%-2%；微型（<1000万）：1%-3%
export function getTierHighLowFloatRange(tier: number): { floatMin: number; floatMax: number } {
  switch (tier) {
    case 6: return { floatMin: 0.0001, floatMax: 0.0015 }; // 巨鲸: 0.01%-0.15%
    case 5: return { floatMin: 0.0005, floatMax: 0.003 };  // 巨型: 0.05%-0.3%
    case 4: return { floatMin: 0.001, floatMax: 0.005 };   // 大型: 0.1%-0.5%
    case 3: return { floatMin: 0.002, floatMax: 0.01 };    // 中型: 0.2%-1%
    case 2: return { floatMin: 0.005, floatMax: 0.02 };    // 小型: 0.5%-2%
    default: return { floatMin: 0.01, floatMax: 0.03 };    // 微型: 1%-3%
  }
}
// ============ 代币随机波动率范围（按tier） ============
// 单回合随机波动率范围（小数形式，如0.01表示1%）
// tier 1(微型): 2%-5%, tier 2(小型): 1%-3%, tier 3(中型): 0.5%-2%
// tier 4(大型): 0.3%-1%, tier 5(巨型): 0.2%-0.5%, tier 6(巨鲸): 0.1%-0.2%
export function getTierVolatilityRange(tier: number): { volMin: number; volMax: number } {
  switch (tier) {
    case 6: return { volMin: 0.001, volMax: 0.002 }; // 巨鲸: 0.1%-0.2%
    case 5: return { volMin: 0.002, volMax: 0.005 }; // 巨型: 0.2%-0.5%
    case 4: return { volMin: 0.003, volMax: 0.01 };  // 大型: 0.3%-1%
    case 3: return { volMin: 0.005, volMax: 0.02 };  // 中型: 0.5%-2%
    case 2: return { volMin: 0.01, volMax: 0.03 };   // 小型: 1%-3%
    default: return { volMin: 0.02, volMax: 0.05 };  // 微型: 2%-5%
  }
}
// ============ 合约最大杠杆分级 ============
// 按代币分级与观察标签返回合约最大可用杠杆倍数（新开仓位上限，原有仓位不受影响）
// BTC/ETH：150x；巨鲸(6)：75x；巨型(5)：50x；大型(4)：25x；中型(3)：20x；小型(2)/微型(1)：10x；观察标签：5x
export function getTokenMaxLeverage(token: Token | undefined | null, currentRound?: number): number {
  if (!token) return 10;
  if (token.code === 'BTC' || token.code === 'ETH') return 150;
  // 观察标签代币：最大5x
  const watched = currentRound !== undefined
    ? isTokenWatched(token, currentRound)
    : (token.watchEndRound !== undefined && token.watchEndRound !== null && token.watchEndRound > 0);
  if (watched) return 5;
  const tier = getTokenTier(token);
  if (tier >= 6) return 75;  // 巨鲸
  if (tier === 5) return 50; // 巨型
  if (tier === 4) return 25; // 大型
  if (tier === 3) return 20; // 中型
  return 10;                 // 小型与微型
}
// ============ 突发事件（黑客攻击）辅助函数 ============
// 判断代币是否处于黑客攻击状态（攻击当回合及后续7天内）
export function isHackedToken(token: Token, currentRound: number): boolean {
  return token.hackEndRound !== undefined && token.hackEndRound !== null && token.hackEndRound > currentRound;
}
// 判断代币本回合是否刚遭受黑客攻击（当回合下跌，暂不停牌）
export function isHackAttackRound(token: Token, currentRound: number): boolean {
  return token.hackStartRound === currentRound;
}
// 判断代币现货是否暂停交易（黑客攻击等现货停牌事件：触发当回合不暂停，随后7天暂停）
export function isSpotSuspended(token: Token, currentRound: number): boolean {
  if (!isHackedToken(token, currentRound)) return false;
  if (token.hackStartRound === currentRound) return false;
  return true;
}
// 判断代币合约是否暂停开仓（监管叫停/保险基金不足：仅允许平仓）
export function isFuturesOpenBlocked(token: Token, currentRound: number): boolean {
  return token.futuresOpenBlockEndRound !== undefined && token.futuresOpenBlockEndRound !== null && token.futuresOpenBlockEndRound > currentRound;
}
// 判断代币是否处于做市商破产状态（现货与合约盘口订单生成减少50%）
export function isTokenOrderReduced(token: Token, currentRound: number): boolean {
  return token.mmBankruptEndRound !== undefined && token.mmBankruptEndRound !== null && token.mmBankruptEndRound > currentRound;
}
// 当前现货暂停事件名称（UI文案，旧存档回退为黑客攻击）
export function getSpotSuspendEventTitle(token: Token): string {
  const ev = SUDDEN_EVENTS.find(e => e.id === token.spotSuspendEventId);
  return ev ? ev.title : '黑客攻击';
}
// 当前合约禁开仓事件名称（UI文案）
export function getFuturesOpenBlockEventTitle(token: Token): string {
  const ev = SUDDEN_EVENTS.find(e => e.id === token.futuresOpenBlockEventId);
  return ev ? ev.title : '突发事件';
}
