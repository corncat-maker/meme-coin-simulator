// 从 src/App.tsx 机械搬迁（Stage 1），逻辑未改动。
import type { OrderBookEntry } from '../types';

// ============ 格式化缓存（性能优化） ============
// 有界缓存：同一轮渲染中大量重复调用格式化函数时避免重复计算字符串
export function createFormatCache(maxSize = 3000) {
  const cache = new Map<string, string>();
  return (key: string, compute: () => string): string => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = compute();
    if (cache.size >= maxSize) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(key, value);
    return value;
  };
}

export const formatNumberCache = createFormatCache();
export const formatSignificantCache = createFormatCache();
export const formatPriceCache = createFormatCache();

export const formatNumber = (num: number, decimals: number = 2): string =>
  formatNumberCache(`${num}_${decimals}`, () => {
    const absNum = Math.abs(num);
    // 使用英文单位：K(千), M(百万), B(十亿), T(万亿)
    if (absNum >= 1000000000000) return (num / 1000000000000).toFixed(2) + 'T'; // 万亿
    if (absNum >= 1000000000) return (num / 1000000000).toFixed(2) + 'B'; // 十亿
    if (absNum >= 1000000) return (num / 1000000).toFixed(2) + 'M'; // 百万
    if (absNum >= 1000) return (num / 1000).toFixed(2) + 'K'; // 千
    return num.toFixed(decimals);
  });

// 四位有效数字格式化 - 用于平均开仓价显示
export const formatSignificant = (num: number, significantDigits: number = 4): string =>
  formatSignificantCache(`${num}_${significantDigits}`, () => {
    if (num === 0) return '0';
    if (!isFinite(num)) return '0';
    
    // 使用 toPrecision 获取指定位数有效数字
    const str = num.toPrecision(significantDigits);
    
    // 如果结果包含科学计数法，转换为普通数字表示
    if (str.includes('e') || str.includes('E')) {
      const parsed = parseFloat(str);
      const absNum = Math.abs(parsed);
      if (absNum >= 1e6 || (absNum < 1e-4 && absNum > 0)) {
        // 对于极大或极小的数字，使用科学计数法但限制有效数字
        return parsed.toExponential(significantDigits - 1);
      }
      // 否则转换为普通数字
      return parsed.toFixed(10).replace(/\.?0+$/, '');
    }
    
    // 去除末尾多余的零
    return parseFloat(str).toString();
  });

// 价格格式化 - BTC和ETH使用6位有效数字，其他代币使用4位有效数字
export const formatPrice = (price: number, tokenCode?: string): string =>
  formatPriceCache(`${price}_${tokenCode || ''}`, () => {
    if (price === 0) return '0';
    if (!isFinite(price)) return '0';
    
    // BTC和ETH使用6位有效数字，其他代币使用4位有效数字
    const significantDigits = (tokenCode === 'BTC' || tokenCode === 'ETH') ? 6 : 4;
    
    // 使用 toPrecision 获取指定位数有效数字
    const str = price.toPrecision(significantDigits);
    
    // 如果结果包含科学计数法，转换为普通数字表示
    if (str.includes('e') || str.includes('E')) {
      const num = parseFloat(str);
      // 对于非常小或非常大的数字，保留有效数字
      const absNum = Math.abs(num);
      if (absNum >= 1e6 || (absNum < 1e-4 && absNum > 0)) {
        // 对于极大或极小的数字，使用科学计数法但限制有效数字
        return num.toExponential(significantDigits - 1);
      }
      // 否则转换为普通数字
      return num.toFixed(10).replace(/\.?0+$/, '');
    }
    
    // 去除末尾多余的零
    return parseFloat(str).toString();
  });

/**
 * 计算盘口每行阶梯背景色块的宽度百分比
 * 规则：下一档包含上一档的数量，色块从右侧向左侧蔓延
 * 默认从列表顶部向下累计；卖盘传 { fromBottom: true } 时从底部（贴近现价）向上累计，形成倒阶梯
 * 宽度 = 累计数量 / 该侧总数量 * 100
 * @param rows 盘口行数组（按展示顺序）
 */
export function computeDepthPercent(rows: OrderBookEntry[], opts?: { fromBottom?: boolean }): number[] {
  const total = rows.reduce((sum, r) => sum + (r.total > 0 ? r.total : 0), 0);
  if (total <= 0) return rows.map(() => 0);
  const pcts: number[] = new Array(rows.length);
  let cum = 0;
  if (opts?.fromBottom) {
    for (let i = rows.length - 1; i >= 0; i--) {
      cum += rows[i].total > 0 ? rows[i].total : 0;
      pcts[i] = Math.min(100, (cum / total) * 100);
    }
  } else {
    for (let i = 0; i < rows.length; i++) {
      cum += rows[i].total > 0 ? rows[i].total : 0;
      pcts[i] = Math.min(100, (cum / total) * 100);
    }
  }
  return pcts;
}
