// 域四-3：合约下架四步强平结算（纯函数）
// 从 src/App.tsx 的下架结算块机械搬迁：只做结算计算，不 setState / 不 setTimeout / 不修改入参。
// 玩家持仓的四步结算依赖「本回合强平模拟之后」的最新快照（由调用方以 playerPositions 显式传入）。
import type {
  AIMarketMaker,
  AITrader,
  Announcement,
  DelistReason,
  FuturesPosition,
  FuturesTradeRecord,
  Token,
} from '../types';
import { getDelistReasonText } from './delist';

/** 资金操作（与域三-3 的 liquidation cashOps 同构，按序应用以还原旧 setState 语义） */
export interface DelistCashOp {
  target: 'available' | 'frozen';
  kind: 'set' | 'add';
  amount: number;
  clampZero?: boolean;
}

export interface DelistSettlementToast {
  message: string;
  type: 'error';
  delay: number;
}

export interface DelistSettlementInput {
  newRound: number;
  tokens: Token[];
  delistedTokensWithReason: { id: string; code: string; reason: DelistReason }[];
  delistAvgPriceByToken: Record<string, number>;
  playerClosePrice: Map<string, number>;
  aiClosePrices: Map<string, number[]>;
  mmClosePrices: Map<string, number[]>;
  /** 当回合强平模拟之后的最新玩家持仓（绝不使用回合开始快照） */
  playerPositions: FuturesPosition[];
  aiTraders: AITrader[];
  aiMarketMakers: AIMarketMaker[];
  makeId: () => string;
}

export interface DelistSettlementResult {
  delistPriceByToken: Record<string, number>;
  playerPositions: FuturesPosition[];
  cashOps: DelistCashOp[];
  aiTraders: AITrader[];
  aiMarketMakers: AIMarketMaker[];
  tradeRecords: FuturesTradeRecord[];
  announcements: Announcement[];
  toasts: DelistSettlementToast[];
}

export function settleDelistedTokens(input: DelistSettlementInput): DelistSettlementResult {
  const {
    newRound,
    tokens,
    delistedTokensWithReason,
    delistAvgPriceByToken,
    playerClosePrice,
    aiClosePrices,
    mmClosePrices,
    playerPositions,
    aiTraders,
    aiMarketMakers,
    makeId,
  } = input;

  const delistedTokenIds = new Set<string>(delistedTokensWithReason.map(d => d.id));
  const tokenCodeById: Record<string, string> = {};
  delistedTokensWithReason.forEach(d => { tokenCodeById[d.id] = d.code; });

  // 下架结算价：优先使用下架前 4 小时记录的 24h 均价，否则回退到预计算均价
  const delistPriceByToken: Record<string, number> = {};
  delistedTokensWithReason.forEach(d => {
    const token = tokens.find(t => t.id === d.id);
    const recordedAvg = typeof token?.delistAvgPrice === 'number' && token.delistAvgPrice > 0 ? token.delistAvgPrice : 0;
    delistPriceByToken[d.id] = Math.max(0.0000001, recordedAvg > 0 ? recordedAvg : (delistAvgPriceByToken[d.id] || 0));
  });

  const tradeRecords: FuturesTradeRecord[] = [];
  const cashOps: DelistCashOp[] = [];
  const calcPnl = (side: 'long' | 'short', entryPrice: number, closePrice: number, quantity: number) =>
    side === 'long' ? (closePrice - entryPrice) * quantity : (entryPrice - closePrice) * quantity;
  const makeTradeRecord = (
    tokenId: string,
    side: 'long' | 'short',
    action: 'adl' | 'liquidation',
    price: number,
    quantity: number,
    pnl: number,
    margin: number
  ): FuturesTradeRecord => ({
    id: makeId(),
    tokenId,
    tokenCode: tokenCodeById[tokenId] || 'UNKNOWN',
    orderType: 'market',
    action,
    side,
    price,
    quantity,
    value: price * quantity,
    pnl,
    margin,
    timestamp: newRound,
  });

  // ===== 玩家仓位：盈利按均价 ADL、亏损市价吃单、残留按平均开仓价结算 =====
  // 资金结算与普通平仓一致：返还保证金 + 盈亏，释放冻结保证金（逐仓按旧顺序生成 cashOp）
  const remainingPlayerPositions: FuturesPosition[] = [];
  playerPositions.forEach(pos => {
    if (!delistedTokenIds.has(pos.tokenId)) { remainingPlayerPositions.push(pos); return; }
    const closePrice = playerClosePrice.get(pos.id) || delistPriceByToken[pos.tokenId] || pos.entryPrice;
    const pnl = calcPnl(pos.side, pos.entryPrice, closePrice, pos.quantity);
    tradeRecords.push(makeTradeRecord(
      pos.tokenId, pos.side, pnl > 0 ? 'adl' : 'liquidation', closePrice, pos.quantity, pnl, pos.margin
    ));
    cashOps.push({ target: 'available', kind: 'add', amount: pos.margin + pnl, clampZero: true });
    cashOps.push({ target: 'frozen', kind: 'add', amount: -pos.margin, clampZero: true });
  });

  // ===== AI 交易员仓位（开仓时保证金已从可用资金扣除，平仓返还 保证金 + 盈亏） =====
  // 结算价队列按顺序消费（克隆，避免修改入参）
  const aiPriceQueues = new Map<string, number[]>();
  aiClosePrices.forEach((v, k) => aiPriceQueues.set(k, [...v]));
  const settledAiTraders = aiTraders.map(trader => {
    const positionsToClose = trader.futuresPositions.filter(p => delistedTokenIds.has(p.tokenId));
    if (positionsToClose.length === 0) return trader;
    let settlement = 0;
    positionsToClose.forEach(pos => {
      const feature = `${pos.tokenId}|${pos.side}|${pos.entryPrice}|${pos.quantity}|${pos.margin}`;
      const key = `${trader.id}::${feature}`;
      const priceArr = aiPriceQueues.get(key);
      const closePrice = priceArr && priceArr.length > 0 ? priceArr.shift()! : (delistPriceByToken[pos.tokenId] || pos.entryPrice);
      const pnl = calcPnl(pos.side, pos.entryPrice, closePrice, pos.quantity);
      settlement += pos.margin + pnl;
    });
    return {
      ...trader,
      futuresPositions: trader.futuresPositions.filter(p => !delistedTokenIds.has(p.tokenId)),
      availableCapital: Math.max(0, trader.availableCapital + settlement),
      pendingLimitOrders: trader.pendingLimitOrders.filter(o => !delistedTokenIds.has(o.tokenId)),
    };
  });

  // ===== 做市商仓位 =====
  const mmPriceQueues = new Map<string, number[]>();
  mmClosePrices.forEach((v, k) => mmPriceQueues.set(k, [...v]));
  const settledAiMarketMakers = aiMarketMakers.map(mm => {
    const positionsToClose = mm.futuresPositions.filter(p => delistedTokenIds.has(p.tokenId));
    if (positionsToClose.length === 0) return mm;
    let settlement = 0;
    positionsToClose.forEach(pos => {
      const feature = `${pos.tokenId}|${pos.side}|${pos.entryPrice}|${pos.quantity}|${pos.margin}`;
      const key = `${mm.id}::${feature}`;
      const priceArr = mmPriceQueues.get(key);
      const closePrice = priceArr && priceArr.length > 0 ? priceArr.shift()! : (delistPriceByToken[pos.tokenId] || pos.entryPrice);
      const pnl = calcPnl(pos.side, pos.entryPrice, closePrice, pos.quantity);
      settlement += pos.margin + pnl;
    });
    return {
      ...mm,
      futuresPositions: mm.futuresPositions.filter(p => !delistedTokenIds.has(p.tokenId)),
      availableCapital: Math.max(0, mm.availableCapital + settlement),
      pendingLimitOrders: mm.pendingLimitOrders.filter(o => !delistedTokenIds.has(o.tokenId)),
    };
  });

  // ===== 下架提示与公告（只返回数据，App 侧按旧顺序统一触发：先 toast 后公告） =====
  const reasonMessages: Record<string, string> = {
    liquidity: '流动性不足',
    manipulation: '操纵嫌疑',
    fraud: '诈骗嫌疑',
    futures_manipulation: '合约操纵',
    dev: '开发者指定',
  };
  const messages = delistedTokensWithReason
    .map(t => `${t.code}(${reasonMessages[t.reason] || t.reason})`)
    .join(', ');
  const toasts: DelistSettlementToast[] = [{
    message: `⚠️ ${messages} 已正式下架，合约仓位已按近24小时平均价格强制平仓`,
    type: 'error',
    delay: 500,
  }];

  const announcements: Announcement[] = delistedTokensWithReason.map(t => {
    const tk = tokens.find(x => x.code === t.code);
    return {
      id: makeId(),
      type: 'delist',
      title: `🚫 ${t.code} 已下架`,
      content: `${t.code} 合约市场已正式下架（原因：${getDelistReasonText(t.reason)}），全部合约仓位已按近24小时平均价格强制平仓。`,
      round: newRound,
      day: Math.floor(newRound / 24) + 1,
      tokenCode: t.code,
      tokenName: tk?.name || '',
      status: 'executed',
      delistRound: newRound,
    };
  });

  return {
    delistPriceByToken,
    playerPositions: remainingPlayerPositions,
    cashOps,
    aiTraders: settledAiTraders,
    aiMarketMakers: settledAiMarketMakers,
    tradeRecords,
    announcements,
    toasts,
  };
}
