import type { PendingTransfer, PlayerTokenBalance, Position, Token } from '../types';

export interface TransferSettlementPlan {
  availableCapitalDelta: number;
  walletUsdtDelta: number;
  balanceDeltas: Record<string, PlayerTokenBalance>;
  reserveDeltas: Record<string, number>;
  deposits: Array<{ tokenId: string; amount: number; price: number }>;
}

// 来源在提交时已扣除；到账只记入目的地，不再次扣款。
export function planTransferSettlement(
  transfers: readonly PendingTransfer[],
  tokens: readonly Token[],
): TransferSettlementPlan {
  const plan: TransferSettlementPlan = {
    availableCapitalDelta: 0, walletUsdtDelta: 0,
    balanceDeltas: {}, reserveDeltas: {}, deposits: [],
  };
  const tokenById = new Map(tokens.map(token => [token.id, token]));
  for (const transfer of transfers) {
    if (transfer.assetKind === 'usdt') {
      if (transfer.direction === 'cexToWallet') plan.walletUsdtDelta += transfer.amount;
      else plan.availableCapitalDelta += transfer.amount;
      continue;
    }
    const tokenId = transfer.tokenId!;
    const delta = plan.balanceDeltas[tokenId] ??= {
      cexBalance: 0, walletBalance: 0, pendingCex: 0, pendingWallet: 0,
    };
    if (transfer.direction === 'cexToWallet') {
      delta.pendingWallet -= transfer.amount;
      delta.walletBalance += transfer.amount;
      plan.reserveDeltas[tokenId] = (plan.reserveDeltas[tokenId] || 0) - transfer.amount;
    } else {
      delta.pendingCex -= transfer.amount;
      delta.cexBalance += transfer.amount;
      plan.reserveDeltas[tokenId] = (plan.reserveDeltas[tokenId] || 0) + transfer.amount;
      plan.deposits.push({ tokenId, amount: transfer.amount, price: tokenById.get(tokenId)?.currentPrice || 0 });
    }
  }
  return plan;
}

export function applyTransferBalanceDeltas(
  balances: Record<string, PlayerTokenBalance>,
  deltas: TransferSettlementPlan['balanceDeltas'],
): Record<string, PlayerTokenBalance> {
  if (Object.keys(deltas).length === 0) return balances;
  const next = { ...balances };
  for (const [tokenId, delta] of Object.entries(deltas)) {
    const entry = balances[tokenId] || { cexBalance: 0, walletBalance: 0, pendingCex: 0, pendingWallet: 0 };
    next[tokenId] = {
      cexBalance: entry.cexBalance + delta.cexBalance,
      walletBalance: entry.walletBalance + delta.walletBalance,
      pendingCex: Math.max(0, entry.pendingCex + delta.pendingCex),
      pendingWallet: Math.max(0, entry.pendingWallet + delta.pendingWallet),
    };
  }
  return next;
}

// 维持原充值成本口径：已有仓位保留成本，新仓按到账时价格建立。
export function applyTransferDeposits(
  positions: Position[],
  deposits: TransferSettlementPlan['deposits'],
  makeId: () => string,
): Position[] {
  let next = positions;
  for (const { tokenId, amount, price } of deposits) {
    const target = next.find(position => position.tokenId === tokenId);
    if (target) {
      const quantity = target.quantity + amount;
      next = next.map(position => position === target ? {
        ...position, quantity, marketValue: quantity * (price || position.currentPrice),
      } : position);
    } else {
      next = [...next, { id: makeId(), tokenId, quantity: amount, avgCost: price,
        currentPrice: price, marketValue: amount * price, pnl: 0, pnlPercent: 0, profitLoss: 0 }];
    }
  }
  return next;
}