// 从 src/App.tsx 机械搬迁（Stage 1），逻辑未改动。
import { TOKEN_DATA } from '../constants';
import type { Candle, Token } from '../types';
import { calculateTierFromMarketCap } from './tokenMeta';
import { initializeTokenReserves } from '../logic/inventory';

export function generateTokens(): Token[] {
  const tokens: Token[] = [];
  
  // 使用新的代币数据生成代币
  TOKEN_DATA.forEach((tokenData, index) => {
    const { name, code, sector, supply, price } = tokenData;
    const marketCap = supply * price;
    const tier = calculateTierFromMarketCap(marketCap);
    
    // 所有预设代币默认上架CEX和合约市场
    const cexListed = true;
    const futuresListed = true;

    tokens.push({
      id: `token-${index}`,
      name,
      code,
      sector,
      initialMarketCap: marketCap,
      initialPrice: price,
      currentPrice: price,
      circulatingSupply: supply,
      totalSupply: supply,
      marketCap,
      change24h: (Math.random() - 0.5) * 10, // 初始随机涨跌幅
      tier, // 初始tier按初始有效市值计算
      ...initializeTokenReserves(supply, tier), // 宏观库存池初始分配（CEX/DEX 物理库存）
      earlyHolders: supply * (0.05 + Math.random() * 0.15), // 5%-20%早期持仓者
      athPrice: price,
      roundPriceChange: 0,
      prevAvailableSupply: supply,
      hourlyPrices: [{ hour: 0, price }],
      cexListed, // 现货CEX上架状态
      futuresListed, // 合约市场上架状态
      // 初始化市值历史记录
      marketCapHistory: [{ round: 0, marketCap }],
      // 初始流动性池USDT将在游戏初始化时设置
      initialLiquidityUsdt: 0,
      // 初始化强平历史
      liquidationHistory: [],
      liquidationAmount24h: 0,
    });
  });
  
  return tokens;
}

/**
 * 初始 K 线：第 1 天 00:00 不生成任何 K 线（该时点所有代币波动为 0，无意义）。
 * 首根 K 线在第 1 回合（第 1 天 01:00）由 calculateNextCandle 生成。
 */
export function createGenesisCandle(_price: number): Candle[] {
  return [];
}
