// ============ 质押借币（AAVE / Compound / MakerDAO）纯逻辑 ============
// 说明：本模块不依赖 React，仅包含协议参数、TVL 额度、利息与风险率的纯函数，便于回归测试。
import type { LoanPosition, LoanProtocolId } from '../types';

// 各 tier 的全局最高可借额度（USDT）：巨鲸 1B / 巨型 100M / 大型 10M / 中型 5M / 小型 1M
// tier 1 = 微型，不可借；观察标签在业务层视为 rank 0，同样不可借
export const LOAN_TIER_TVL_CAP: Record<number, number> = {
  6: 1_000_000_000,
  5: 100_000_000,
  4: 10_000_000,
  3: 5_000_000,
  2: 1_000_000,
  1: 0,
};

export const LOAN_TIER_LABELS: Record<number, string> = {
  6: '巨鲸',
  5: '巨型',
  4: '大型',
  3: '中型',
  2: '小型',
  1: '微型',
};

export interface LoanProtocolConfig {
  id: LoanProtocolId;
  name: string;
  tagline: string;
  annualRate: number; // 年化利率
  ltv: number; // 基础质押率（可借最大金额 = 质押物价值 × ltv）
  liquidationThreshold: number; // 触发强制清算的风险率阈值（0.9 = 90%）
  quotaRatio: number; // 该协议可用额度占 tier TVL 上限的比例
  minTier: number; // 支持的最低 tier（AAVE 仅巨鲸=6；Compound 大型及以上=4；MakerDAO 小型及以上=2）
  accent: string; // 协议主题色（沿用深色 UI 风格）
}

export const LOAN_PROTOCOLS: LoanProtocolConfig[] = [
  {
    id: 'aave',
    name: 'AAVE',
    tagline: '全能型',
    annualRate: 0.15,
    ltv: 0.8,
    liquidationThreshold: 0.9,
    quotaRatio: 1,
    minTier: 6,
    accent: '#b6509e',
  },
  {
    id: 'compound',
    name: 'Compound',
    tagline: '性价比型',
    annualRate: 0.1,
    ltv: 0.6,
    liquidationThreshold: 0.8,
    quotaRatio: 0.5,
    minTier: 4,
    accent: '#00d395',
  },
  {
    id: 'makerdao',
    name: 'MakerDAO',
    tagline: '通用型',
    annualRate: 0.25,
    ltv: 0.5,
    liquidationThreshold: 0.75,
    quotaRatio: 0.5,
    minTier: 2,
    accent: '#1aab9b',
  },
];

export const LOAN_PROTOCOL_MAP: Record<LoanProtocolId, LoanProtocolConfig> = LOAN_PROTOCOLS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<LoanProtocolId, LoanProtocolConfig>
);

/** 代币 tier 对应的全局最高可借额度（USDT） */
export function getTierTvlCap(tier: number): number {
  return LOAN_TIER_TVL_CAP[tier] ?? 0;
}

/** 某协议在某 tier 下的可用额度上限（USDT） */
export function getProtocolTvlCap(tier: number, protocol: LoanProtocolId | LoanProtocolConfig): number {
  const cfg = typeof protocol === 'string' ? LOAN_PROTOCOL_MAP[protocol] : protocol;
  if (!cfg) return 0;
  return getTierTvlCap(tier) * cfg.quotaRatio;
}

/** 协议是否支持该 tier */
export function isProtocolSupportTier(protocol: LoanProtocolId | LoanProtocolConfig, tier: number): boolean {
  const cfg = typeof protocol === 'string' ? LOAN_PROTOCOL_MAP[protocol] : protocol;
  if (!cfg) return false;
  if (tier <= 0) return false;
  return tier >= cfg.minTier && getTierTvlCap(tier) > 0;
}

/** 单回合计息量（年化利率 ÷ 365 天 ÷ 24 小时） */
export function getRoundInterestRate(annualRate: number): number {
  return annualRate / 365 / 24;
}

/** 待还利息 = 本金 × (年化利率 ÷ 365 ÷ 24) × 实际借款回合数 */
export function calculateLoanInterest(principal: number, annualRate: number, startRound: number, currentRound: number): number {
  const rounds = Math.max(0, currentRound - startRound);
  return principal * getRoundInterestRate(annualRate) * rounds;
}

/** 单个仓位的待还利息（含部分还款时已结算的利息） */
export function calculateAccruedInterest(loan: LoanPosition, currentRound: number): number {
  const cfg = LOAN_PROTOCOL_MAP[loan.protocol];
  if (!cfg) return 0;
  return Math.max(0, loan.accruedInterest || 0) + calculateLoanInterest(loan.principal, cfg.annualRate, loan.startRound, currentRound);
}

/** 待还总额（本金 + 待还利息） */
export function calculateLoanDebt(loan: LoanPosition, currentRound: number): number {
  return loan.principal + calculateAccruedInterest(loan, currentRound);
}

/** 风险率 = (借款本金 + 待还总利息) / 质押物当前总价值 × 100（%） */
export function calculateRiskRatio(loan: LoanPosition, currentRound: number, tokenPrice: number): number {
  const collateralValue = loan.collateralQuantity * tokenPrice;
  if (!(collateralValue > 0)) return Infinity;
  return (calculateLoanDebt(loan, currentRound) / collateralValue) * 100;
}

export type RiskLevel = 'safe' | 'warn' | 'danger';

/** 某协议的清算风险率阈值（百分数），如 AAVE 90 / Compound 80 / MakerDAO 75 */
export function getProtocolLiquidationThreshold(protocol: LoanProtocolId | LoanProtocolConfig): number {
  const cfg = typeof protocol === 'string' ? LOAN_PROTOCOL_MAP[protocol] : protocol;
  return cfg ? cfg.liquidationThreshold * 100 : 80;
}

/**
 * 风险率颜色分级（阈值随协议变化）：
 * <60% 绿色（安全）；60%~协议阈值 黄色（警告）；≥协议阈值 红色（危险，触发强制清算）
 */
export function getRiskLevel(riskRatio: number, liquidationThreshold = 80): RiskLevel {
  if (!Number.isFinite(riskRatio)) return 'danger';
  if (riskRatio >= liquidationThreshold) return 'danger';
  if (riskRatio >= 60) return 'warn';
  return 'safe';
}

export function getRiskColor(riskRatio: number, liquidationThreshold = 80): string {
  const level = getRiskLevel(riskRatio, liquidationThreshold);
  if (level === 'danger') return '#f6465d';
  if (level === 'warn') return '#f0b90b';
  return '#0ecb81';
}

/** 可借最大金额 = 质押物价值 × 基础质押率 */
export function calculateMaxBorrow(collateralQuantity: number, tokenPrice: number, ltv: number): number {
  return Math.max(0, collateralQuantity * tokenPrice * ltv);
}

/** 按协议汇总某代币已借出本金 */
export function sumBorrowedForToken(loans: LoanPosition[], tokenId: string, protocol?: LoanProtocolId): number {
  return loans.reduce(
    (sum, l) => (l.tokenId === tokenId && (!protocol || l.protocol === protocol) ? sum + l.principal : sum),
    0
  );
}

/** 某代币在指定协议下的剩余可借额度（同时受全局 tier 上限与协议额度上限约束） */
export function getRemainingBorrowCapacity(
  loans: LoanPosition[],
  tokenId: string,
  tier: number,
  protocol: LoanProtocolId
): number {
  const tokenTotal = sumBorrowedForToken(loans, tokenId);
  const protocolTotal = sumBorrowedForToken(loans, tokenId, protocol);
  const tierCap = getTierTvlCap(tier);
  const protocolCap = getProtocolTvlCap(tier, protocol);
  return Math.max(0, Math.min(tierCap - tokenTotal, protocolCap - protocolTotal));
}

/** 已质押代币数量（按代币汇总），用于限制现货/DEX 卖出与添加流动性 */
export function getLockedCollateralMap(loans: LoanPosition[]): Record<string, number> {
  const map: Record<string, number> = {};
  loans.forEach(loan => {
    map[loan.tokenId] = (map[loan.tokenId] || 0) + loan.collateralQuantity;
  });
  return map;
}
