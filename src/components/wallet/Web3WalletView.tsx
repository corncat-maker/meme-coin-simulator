import { useMemo, useState } from 'react';
import type {
  LiquidityPoolMap,
  PendingTransfer,
  PlayerTokenBalance,
  Token,
  WalletLpPosition,
} from '../../types';
import { calculateAMMBuyPrice, calculateAMMSellPrice } from '../../logic/amm';
import { formatNumber, formatPrice } from '../../utils/format';
import { TokenLogo } from '../common/TokenLogo';
import { WalletTokenPicker, type WalletTokenOption } from './WalletTokenPicker';
import { WalletAmountShortcuts } from './WalletAmountShortcuts';
import './wallet-workspace.css';

export interface WalletLoanItem {
  id: string;
  tokenCode: string;
  protocolName: string;
  collateralQuantity: number;
  debt: number;
  riskRatio: number;
  liquidationThresholdPercent: number;
}

interface Web3WalletViewProps {
  tokens: Token[];
  balances: Record<string, PlayerTokenBalance>;
  walletUsdt: number;
  pendingTransfers: PendingTransfer[];
  liquidityPools: LiquidityPoolMap;
  walletLpPositions: Record<string, WalletLpPosition>;
  currentRound: number;
  cexUsdtAvailable: number;
  getCexTokenAvailable: (tokenId: string) => number;
  isFastForwarding: boolean;
  onFastForward: () => void;
  onTransfer: (assetKind: 'usdt' | 'token', tokenId: string | undefined, direction: 'cexToWallet' | 'walletToCex', amount: number) => boolean;
  onDexSwap: (tokenId: string, direction: 'buy' | 'sell', amount: number) => boolean;
  onAddLiquidity: (tokenId: string, quoteAmount: number) => boolean;
  onRemoveLiquidity: (tokenId: string, percent: number) => boolean;
  getWalletAvailableToken: (tokenId: string) => number;
  loanCount: number;
  loanDebt: number;
  loanCollateralValue: number;
  loans: WalletLoanItem[];
  lockedCollateralByToken: Record<string, number>;
  onOpenRepay: (loanId: string) => void;
  onOpenLoan: () => void;
}

type WalletView = 'home' | 'swap' | 'liquidity' | 'transfer';

const VIEW_TITLES: Record<WalletView, string> = {
  home: '链上钱包',
  swap: 'DEX 交易',
  liquidity: '流动性管理',
  transfer: '充提币',
};

export function Web3WalletView({
  tokens,
  balances,
  walletUsdt,
  pendingTransfers,
  liquidityPools,
  walletLpPositions,
  currentRound,
  cexUsdtAvailable,
  getCexTokenAvailable,
  isFastForwarding,
  onFastForward,
  onTransfer,
  onDexSwap,
  onAddLiquidity,
  onRemoveLiquidity,
  getWalletAvailableToken,
  loanCount,
  loanDebt,
  loanCollateralValue,
  loans,
  lockedCollateralByToken,
  onOpenRepay,
  onOpenLoan,
}: Web3WalletViewProps) {
  const [view, setView] = useState<WalletView>('home');
  const [selectedTokenId, setSelectedTokenId] = useState<string>('');
  const [amountInput, setAmountInput] = useState('');
  const [swapDirection, setSwapDirection] = useState<'buy' | 'sell'>('buy');
  const [transferDirection, setTransferDirection] = useState<'cexToWallet' | 'walletToCex'>('cexToWallet');
  const [transferAsset, setTransferAsset] = useState<'usdt' | 'token'>('usdt');
  const [pickerMode, setPickerMode] = useState<null | 'swap' | 'liquidity' | 'transfer'>(null);
  const [liquidityMode, setLiquidityMode] = useState<'add' | 'remove'>('add');
  const [removePercent, setRemovePercent] = useState(25);
  const [liquidityTokenInput, setLiquidityTokenInput] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ title: string; detail: string } | null>(null);

  const tokenMap = useMemo(() => new Map(tokens.map(t => [t.id, t])), [tokens]);
  const walletTokens = useMemo(() => tokens
    .map(token => {
      const balance = balances[token.id];
      const amount = balance?.walletBalance || 0;
      const locked = lockedCollateralByToken[token.id] || 0;
      return { token, amount, locked, usdValue: (amount + locked) * token.currentPrice };
    })
    .filter(item => item.amount > 1e-9 || item.locked > 1e-9)
    .sort((a, b) => b.usdValue - a.usdValue), [tokens, balances, lockedCollateralByToken]);
  const tokenAssetsValue = walletTokens.reduce((sum, item) => sum + item.usdValue, 0);
  const totalValue = walletUsdt + tokenAssetsValue;
  const pendingTotal = pendingTransfers.reduce((sum, item) => {
    if (item.assetKind === 'usdt') return sum + item.amount;
    const token = item.tokenId ? tokenMap.get(item.tokenId) : null;
    return sum + item.amount * (token?.currentPrice || 0);
  }, 0);

  const selectedToken = selectedTokenId ? tokenMap.get(selectedTokenId) || null : null;
  const selectedPool = selectedToken ? liquidityPools[selectedToken.id] : null;
  const poolReady = !!selectedPool && selectedPool.tokenReserve > 0 && selectedPool.quoteReserve > 0
    && Number.isFinite(selectedPool.tokenReserve) && Number.isFinite(selectedPool.quoteReserve);
  const poolPrice = poolReady ? selectedPool.quoteReserve / selectedPool.tokenReserve : 0;
  const parsedAmount = view === 'liquidity' && liquidityTokenInput !== null
    ? Number(liquidityTokenInput) * poolPrice : Number(amountInput);
  const amount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0;
  const buyTokenAmount = poolReady && swapDirection === 'buy' && amount > 0
    ? Math.min(selectedPool.tokenReserve * 0.999, (amount * selectedPool.tokenReserve) / (selectedPool.quoteReserve * (1 + (selectedPool.fee ?? 0.003)) + amount)) : 0;
  const sellPreview = poolReady && swapDirection === 'sell' && amount > 0
    ? calculateAMMSellPrice(selectedPool, amount) : null;
  const buyPreview = poolReady && buyTokenAmount > 0
    ? calculateAMMBuyPrice(selectedPool, buyTokenAmount) : null;
  const walletLp = selectedToken ? walletLpPositions[selectedToken.id] : undefined;
  const tokenAvailable = selectedToken ? getWalletAvailableToken(selectedToken.id) : 0;
  const outputAmount = swapDirection === 'buy' ? buyTokenAmount : sellPreview?.quoteAmount || 0;
  const impact = Math.abs((swapDirection === 'buy' ? buyPreview : sellPreview)?.priceImpact || 0) * 100;
  const feeRate = selectedPool?.fee ?? 0.003;
  const swapFee = swapDirection === 'buy' ? amount * feeRate / (1 + feeRate)
    : (sellPreview?.quoteAmount || 0) / (1 - feeRate) * feeRate;
  const inputCode = swapDirection === 'buy' ? 'USDT' : selectedToken?.code || '代币';
  const outputCode = swapDirection === 'buy' ? selectedToken?.code || '代币' : 'USDT';
  const myLiquidity = useMemo(() => Object.values(walletLpPositions)
    .filter(lp => lp.shares > 0 && tokenMap.has(lp.tokenId))
    .map(lp => ({ lp, token: tokenMap.get(lp.tokenId)! })), [walletLpPositions, tokenMap]);

  // 充提币数量上限与百分比滑条
  const transferMax = transferAsset === 'usdt'
    ? (transferDirection === 'cexToWallet' ? cexUsdtAvailable : walletUsdt)
    : (selectedToken
      ? (transferDirection === 'cexToWallet' ? getCexTokenAvailable(selectedToken.id) : getWalletAvailableToken(selectedToken.id))
      : 0);
  const transferPercent = transferMax > 0 ? Math.min(100, Math.max(0, (amount / transferMax) * 100)) : 0;
  const applyTransferPercent = (percent: number) => {
    if (!(transferMax > 0)) return;
    const value = (transferMax * percent) / 100;
    setAmountInput(transferAsset === 'usdt' ? value.toFixed(2) : String(Number(value.toFixed(6))));
  };

  // DEX 交易 / 添加流动性：数量百分比滑条
  const swapMax = swapDirection === 'buy'
    ? walletUsdt
    : (selectedToken ? getWalletAvailableToken(selectedToken.id) : 0);
  const swapPercent = swapMax > 0 ? Math.min(100, Math.max(0, (amount / swapMax) * 100)) : 0;
  const applySwapPercent = (percent: number) => {
    if (!(swapMax > 0)) return;
    const value = (swapMax * percent) / 100;
    setReceipt(null);
    setAmountInput(String(value));
  };
  // 按池内配比同时受 USDT 和未质押代币限制；最大值不向上取整。
  const liquidityMax = poolReady ? Math.max(0, Math.min(walletUsdt, tokenAvailable * poolPrice)) * (1 - Number.EPSILON * 4) : 0;
  const liquidityTokenAmount = poolReady ? amount * (selectedPool.tokenReserve / selectedPool.quoteReserve) : 0;
  const lpMinted = poolReady && amount > 0
    ? (selectedPool.lpTokenSupply > 0 ? amount / selectedPool.quoteReserve * selectedPool.lpTokenSupply : Math.sqrt(liquidityTokenAmount * amount)) : 0;
  const lpShareAfter = selectedPool && selectedPool.lpTokenSupply + lpMinted > 0
    ? ((walletLp?.shares || 0) + lpMinted) / (selectedPool.lpTokenSupply + lpMinted) * 100 : 0;
  const removeTokenAmount = (walletLp?.tokenAmount || 0) * removePercent / 100;
  const removeQuoteAmount = (walletLp?.quoteAmount || 0) * removePercent / 100;
  const liquidityPercent = liquidityMax > 0 ? Math.min(100, Math.max(0, (amount / liquidityMax) * 100)) : 0;
  const applyLiquidityPercent = (percent: number) => {
    if (!(liquidityMax > 0)) return;
    setReceipt(null);
    setLiquidityTokenInput(null);
    setAmountInput(String((liquidityMax * percent) / 100));
  };

  // 代币选择器数据源（右侧数字含义按场景区分）
  const pickerOptions = useMemo<WalletTokenOption[]>(() => {
    if (pickerMode === 'swap') {
      return tokens.filter(token => liquidityPools[token.id]).map(token => {
        const pool = liquidityPools[token.id];
        return {
          token,
          usdValue: getWalletAvailableToken(token.id) * token.currentPrice,
          primaryLabel: `可用 ${formatNumber(getWalletAvailableToken(token.id), 6)}`,
          secondaryLabel: `池价 $${formatPrice(pool.quoteReserve / pool.tokenReserve)}`,
        };
      }).sort((a, b) => b.usdValue - a.usdValue);
    }
    if (pickerMode === 'liquidity') {
      return tokens.filter(token => liquidityPools[token.id]).map(token => {
        const pool = liquidityPools[token.id];
        const available = getWalletAvailableToken(token.id);
        return {
          token,
          amount: available,
          usdValue: available * token.currentPrice,
          note: walletLpPositions[token.id]?.shares > 0 ? '已提供流动性' : `池价 $${formatPrice(pool.quoteReserve / pool.tokenReserve)}`,
        };
      }).sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));
    }
    if (pickerMode === 'transfer') {
      return tokens.map(token => {
        const available = transferDirection === 'cexToWallet'
          ? getCexTokenAvailable(token.id)
          : getWalletAvailableToken(token.id);
        return {
          token,
          amount: available,
          usdValue: available * token.currentPrice,
          amountLabel: transferDirection === 'cexToWallet' ? 'CEX' : '钱包',
        };
      }).sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0)); // 按持仓价值降序：提币看 CEX 持仓，充币看链上钱包持仓
    }
    return [];
  }, [pickerMode, tokens, liquidityPools, getCexTokenAvailable, getWalletAvailableToken, transferDirection, walletLpPositions]);

  const resetForm = () => { setAmountInput(''); setLiquidityTokenInput(null); };
  const openView = (next: WalletView) => {
    setView(next); resetForm(); setReceipt(null);
    if (next === 'swap' || next === 'liquidity') {
      const preferred = walletTokens.find(item => liquidityPools[item.token.id])?.token.id
        || tokens.find(token => liquidityPools[token.id])?.id || '';
      if (!selectedTokenId || !liquidityPools[selectedTokenId]) setSelectedTokenId(preferred);
    } else if (next === 'transfer') setSelectedTokenId('');
  };
  const selectToken = (id: string) => {
    setSelectedTokenId(id); resetForm(); setReceipt(null); setRemovePercent(25);
  };
  const changeSwapDirection = (direction: 'buy' | 'sell') => {
    if (direction === swapDirection) return;
    setSwapDirection(direction); resetForm(); setReceipt(null);
  };
  const swapError = !selectedToken ? '请选择交易代币' : !poolReady ? '该代币暂无可用流动性'
    : !Number.isFinite(amount) || amount <= 0 ? ''
    : amount > swapMax + (swapDirection === 'buy' ? 1e-6 : 1e-9) ? `${inputCode} 可用余额不足`
    : !(outputAmount > 0) || !Number.isFinite(outputAmount) ? '该数量暂时无法兑换' : '';
  const canSwap = poolReady && amount > 0 && Number.isFinite(amount) && !swapError;
  const liquidityError = !poolReady ? '请选择有效的流动性池'
    : amount > walletUsdt + 1e-6 ? 'USDT 可用余额不足'
    : liquidityTokenAmount > tokenAvailable + 1e-9 ? `${selectedToken?.code} 可用余额不足` : '';
  const canAdd = poolReady && Number.isFinite(amount) && amount > 0 && !liquidityError;
  const submitSwap = () => {
    if (!selectedToken || !canSwap) return;
    if (onDexSwap(selectedToken.id, swapDirection, amount)) {
      setReceipt({ title: '兑换成功', detail: `支付 ${formatNumber(amount, 6)} ${inputCode}，收到 ${formatNumber(outputAmount, 6)} ${outputCode}` });
      resetForm();
    }
  };
  const submitLiquidity = () => {
    if (!selectedToken || !canAdd) return;
    if (onAddLiquidity(selectedToken.id, amount)) {
      setReceipt({ title: '流动性已添加', detail: `${formatNumber(liquidityTokenAmount, 6)} ${selectedToken.code} + ${formatNumber(amount, 6)} USDT` });
      resetForm();
    }
  };
  const submitRemove = () => {
    if (!selectedToken || !walletLp || !(removeTokenAmount > 0 && removeQuoteAmount > 0)) return;
    if (onRemoveLiquidity(selectedToken.id, removePercent)) {
      setReceipt({ title: '流动性已撤出', detail: `已返还 ${formatNumber(removeTokenAmount, 6)} ${selectedToken.code} + ${formatNumber(removeQuoteAmount, 6)} USDT 至钱包` });
    }
  };

  return (
    <div className="wallet-view" data-testid="wallet-view">
      {view !== 'home' && (
        <div className="wallet-sub-header">
          <button className="wallet-back-btn" onClick={() => openView('home')} data-testid="wallet-back-btn">←</button>
          <span className="wallet-sub-title">{VIEW_TITLES[view]}</span>
          <button className="wallet-ff-btn" onClick={onFastForward} disabled={isFastForwarding}>{isFastForwarding ? '⏳' : '⏩'}</button>
        </div>
      )}

      {view === 'home' && (
        <div className="wallet-home">
          <div className="wallet-total-card">
            <div className="wallet-total-label">钱包总估值</div>
            <div className="wallet-total-value">${formatNumber(totalValue, 2)}</div>
            <div className="wallet-total-sub">
              <span>USDT {formatNumber(walletUsdt, 2)}</span>
              <span>代币 ${formatNumber(tokenAssetsValue, 2)}</span>
            </div>
            <div className="wallet-total-actions">
              <button className="wallet-quick-ff" onClick={onFastForward} disabled={isFastForwarding}>{isFastForwarding ? '⏳ 快进中' : '⏩ 下一回合'}</button>
            </div>
          </div>

          <div className="wallet-grid">
            <button className="wallet-action-card" onClick={() => openView('swap')} data-testid="wallet-action-swap">
              <span className="wallet-action-icon">⇄</span>
              <span className="wallet-action-label">DEX 交易</span>
              <span className="wallet-action-desc">AMM 即时兑换</span>
            </button>
            <button className="wallet-action-card" onClick={() => openView('liquidity')} data-testid="wallet-action-liquidity">
              <span className="wallet-action-icon">💧</span>
              <span className="wallet-action-label">流动性管理</span>
              <span className="wallet-action-desc">添加 / 撤出池子</span>
            </button>
            <button className="wallet-action-card" onClick={() => openView('transfer')} data-testid="wallet-action-transfer">
              <span className="wallet-action-icon">⇅</span>
              <span className="wallet-action-label">充提币</span>
              <span className="wallet-action-desc">次回合到账</span>
            </button>
          </div>

          <button className="wallet-loan-card" onClick={onOpenLoan} data-testid="wallet-loan-entry">
            <span className="wallet-loan-icon">🏦</span>
            <span className="wallet-loan-main">
              <span className="wallet-loan-title">质押借币</span>
              <span className="wallet-loan-desc">
                {loanCount > 0
                  ? `${loanCount} 笔借款 · 待还 $${formatNumber(loanDebt, 2)} · 质押 $${formatNumber(loanCollateralValue, 2)}`
                  : '用链上钱包内的代币质押，借出 USDT（AAVE / Compound / MakerDAO）'}
              </span>
            </span>
            <span className="wallet-loan-arrow">›</span>
          </button>

          {loans.length > 0 && (
            <div className="wallet-loan-list">
              <div className="wallet-section-title">我的借款</div>
              {loans.map(item => (
                <div className="wallet-loan-item" key={item.id}>
                  <div className="wallet-loan-item-head">
                    <span className="wallet-loan-protocol">{item.protocolName}</span>
                    <span className="wallet-loan-token">{item.tokenCode}</span>
                    <span className={`wallet-loan-risk ${item.riskRatio >= item.liquidationThresholdPercent ? 'danger' : item.riskRatio >= 60 ? 'warn' : ''}`}>
                      风险率 {Number.isFinite(item.riskRatio) ? `${item.riskRatio.toFixed(1)}%` : '∞'}
                    </span>
                  </div>
                  <div className="wallet-loan-item-meta">
                    <span>质押 {formatNumber(item.collateralQuantity, 6)} {item.tokenCode}</span>
                    <span>待还 ${formatNumber(item.debt, 2)}</span>
                    <span className="wallet-loan-threshold">清算线 {item.liquidationThresholdPercent}%</span>
                  </div>
                  <button
                    className="wallet-loan-repay-btn"
                    onClick={() => onOpenRepay(item.id)}
                    data-testid={`wallet-loan-repay-${item.tokenCode}`}
                  >
                    还款 / 赎回
                  </button>
                </div>
              ))}
            </div>
          )}

          {pendingTransfers.length > 0 && (
            <div className="wallet-pending-card">
              <div className="wallet-section-title">在途资金 · ${formatNumber(pendingTotal, 2)}</div>
              {pendingTransfers.slice(0, 6).map(item => {
                const token = item.tokenId ? tokenMap.get(item.tokenId) : null;
                return (
                  <div className="wallet-pending-row" key={item.id}>
                    <span className={`wallet-pending-dir ${item.direction}`}>
                      {item.direction === 'cexToWallet' ? '提币' : '充值'}
                    </span>
                    <span className="wallet-pending-asset">{item.assetKind === 'usdt' ? 'USDT' : token?.code}</span>
                    <span className="wallet-pending-amount">{formatNumber(item.amount, item.assetKind === 'usdt' ? 2 : 6)}</span>
                    <span className="wallet-pending-round">第 {item.settleRound} 回合到账</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="wallet-assets">
            <div className="wallet-section-title">链上资产</div>
            {walletTokens.length === 0 ? (
              <div className="wallet-empty">链上钱包暂无资产，可从 CEX 提币到钱包</div>
            ) : (
              walletTokens.map(({ token, amount: tokenAmount, locked, usdValue }) => (
                <div className="wallet-asset-row" key={token.id}>
                  <TokenLogo code={token.code} size={26} />
                  <div className="wallet-asset-main">
                    <span className="wallet-asset-code">{token.code}</span>
                    <span className="wallet-asset-name">{token.name}</span>
                    {locked > 1e-9 && (
                      <span className="wallet-asset-collateral" data-testid={`wallet-asset-collateral-${token.code}`}>
                        质押中 {formatNumber(locked, 4)}
                      </span>
                    )}
                  </div>
                  <div className="wallet-asset-value">
                    <span className="wallet-asset-amount">{formatNumber(tokenAmount, 6)}</span>
                    <span className="wallet-asset-usd">${formatNumber(usdValue, 2)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {(view === 'swap' || view === 'liquidity') && receipt && (
        <div className="wallet-operation-receipt" role="status" data-testid="wallet-operation-receipt">
          <span className="wallet-receipt-check" aria-hidden="true">✓</span>
          <div><strong>{receipt.title}</strong><span>{receipt.detail}</span></div>
          <button type="button" aria-label="关闭操作回执" onClick={() => setReceipt(null)}>×</button>
        </div>
      )}

      {view === 'swap' && (
        <div className="wallet-page wallet-workspace" data-testid="wallet-swap-workspace">
          <div className="wallet-workspace-tabs" role="group" aria-label="兑换方向">
            <button type="button" className={swapDirection === 'buy' ? 'active' : ''} aria-pressed={swapDirection === 'buy'} onClick={() => changeSwapDirection('buy')}>买入代币</button>
            <button type="button" className={swapDirection === 'sell' ? 'active' : ''} aria-pressed={swapDirection === 'sell'} onClick={() => changeSwapDirection('sell')}>卖出代币</button>
          </div>

          <button className="wallet-token-trigger wallet-pair-trigger" onClick={() => setPickerMode('swap')} data-testid="wallet-swap-token" aria-label="选择兑换代币">
            {selectedToken ? <><TokenLogo code={selectedToken.code} size={30} /><span className="wallet-token-trigger-main"><span className="wallet-token-trigger-code">{selectedToken.code} / USDT</span><span className="wallet-token-trigger-name">{selectedToken.name}</span></span></> : <span className="wallet-token-trigger-placeholder">选择交易代币</span>}
            <span className="wallet-token-trigger-chevron">更换 ⌄</span>
          </button>

          <div className="wallet-exchange-stack">
            <div className="wallet-amount-card">
              <div className="wallet-amount-label"><label htmlFor="wallet-swap-amount">支付</label><button type="button" className="wallet-balance-action" onClick={() => applySwapPercent(100)} disabled={swapMax <= 0}>可用 {formatNumber(swapMax, swapDirection === 'buy' ? 2 : 6)} · 最大</button></div>
              <div className="wallet-amount-entry">
                <input id="wallet-swap-amount" className="wallet-input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amountInput} onChange={e => { setAmountInput(e.target.value); setReceipt(null); }} data-testid="wallet-swap-input" aria-invalid={!!swapError} />
                <span className="wallet-currency"><TokenLogo code={inputCode} size={22} /><strong>{inputCode}</strong></span>
              </div>
              <div className="wallet-amount-fiat">{swapDirection === 'buy' ? '从链上钱包 USDT 支付' : `仅使用未质押的 ${selectedToken?.code || '代币'}`}</div>
            </div>
            <button className="wallet-direction-switch" type="button" aria-label="切换买卖方向" title="切换买卖方向" onClick={() => changeSwapDirection(swapDirection === 'buy' ? 'sell' : 'buy')} data-testid="wallet-swap-reverse">⇅</button>
            <div className="wallet-amount-card wallet-receive-card">
              <div className="wallet-amount-label"><span>预计收到</span><span>即时到账</span></div>
              <div className="wallet-amount-entry"><output className="wallet-output" data-testid="wallet-swap-output">{formatNumber(outputAmount, 6)}</output><span className="wallet-currency"><TokenLogo code={outputCode} size={22} /><strong>{outputCode}</strong></span></div>
              <div className="wallet-amount-fiat">{swapDirection === 'buy' ? `钱包持有 ${formatNumber(tokenAvailable, 6)} ${selectedToken?.code || ''}` : `钱包 USDT ${formatNumber(walletUsdt, 2)}`}</div>
            </div>
          </div>

          <WalletAmountShortcuts prefix="wallet-swap" percent={swapPercent} onChange={applySwapPercent} disabled={swapMax <= 0} />

          {selectedToken && poolReady && <div className="wallet-quote-summary" data-testid="wallet-swap-summary">
            <div><span>池内参考价</span><strong>1 {selectedToken.code} ≈ {formatPrice(poolPrice)} USDT</strong></div>
            <div><span>池价影响</span><strong className={impact >= 5 ? 'wallet-text-warning' : ''} data-testid="wallet-swap-impact">{amount > 0 ? `${impact.toFixed(2)}%` : '—'}</strong></div>
            <details className="wallet-quote-details"><summary>费用与池子详情 <span>⌄</span></summary><div><span>手续费率</span><strong>{(feeRate * 100).toFixed(2)}%</strong></div><div><span>预估手续费（已计入）</span><strong>{amount > 0 ? `${formatNumber(swapFee, 6)} USDT` : '—'}</strong></div><div><span>预估成交均价</span><strong>{outputAmount > 0 ? `${formatPrice(swapDirection === 'buy' ? amount / outputAmount : outputAmount / amount)} USDT` : '—'}</strong></div><div><span>池内总流动性</span><strong>${formatNumber(selectedPool.quoteReserve * 2, 2)}</strong></div><p>报价随池内储备变化；池价影响为兑换前后池价变化，含手续费影响。确认时按当前池子兑换。</p></details>
          </div>}
          {canSwap && impact >= 5 && <div className="wallet-inline-notice warning" role="status">池价影响较大（{impact.toFixed(2)}%），可减少支付数量后再兑换。</div>}
          {swapError && <div className="wallet-inline-notice" role="status">{swapError}</div>}
          {swapMax <= 0 && <div className="wallet-inline-notice wallet-funding-prompt"><span>{swapDirection === 'buy' ? '钱包暂无可用 USDT' : '钱包暂无该代币可用余额'}</span><button type="button" onClick={() => openView('transfer')}>从 CEX 提币 ›</button></div>}
          <div className="wallet-submit-area"><button type="button" className="wallet-confirm-btn" disabled={!canSwap || isFastForwarding} data-testid="wallet-swap-confirm" onClick={submitSwap}>{!selectedToken ? '请先选择代币' : amount <= 0 || !Number.isFinite(amount) ? '输入支付数量' : swapError || `确认兑换 ${outputCode}`}</button><span className="wallet-operation-footnote">只使用链上余额 · 不影响 CEX 持仓</span></div>
        </div>
      )}

      {view === 'liquidity' && (
        <div className="wallet-page wallet-workspace" data-testid="wallet-liquidity-workspace">
          <div className="wallet-workspace-tabs" role="group" aria-label="流动性操作">
            <button type="button" className={liquidityMode === 'add' ? 'active' : ''} aria-pressed={liquidityMode === 'add'} onClick={() => { setLiquidityMode('add'); resetForm(); setReceipt(null); }} data-testid="wallet-liquidity-tab-add">添加流动性</button>
            <button type="button" className={liquidityMode === 'remove' ? 'active' : ''} aria-pressed={liquidityMode === 'remove'} onClick={() => { setLiquidityMode('remove'); resetForm(); setReceipt(null); }} data-testid="wallet-liquidity-tab-remove">移除流动性{myLiquidity.length > 0 ? ` · ${myLiquidity.length}` : ''}</button>
          </div>

          {myLiquidity.length > 0 && <div className="wallet-my-pools"><span>我的池子</span><div>{myLiquidity.map(({ lp, token }) => <button type="button" key={lp.tokenId} className={selectedTokenId === lp.tokenId ? 'selected' : ''} onClick={() => selectToken(lp.tokenId)} data-testid={`wallet-my-pool-${token.code}`}><TokenLogo code={token.code} size={18} />{token.code}</button>)}</div></div>}

          <button className="wallet-token-trigger wallet-pair-trigger" onClick={() => setPickerMode('liquidity')} data-testid="wallet-liquidity-token" aria-label="选择流动性池">
            {selectedToken ? <><TokenLogo code={selectedToken.code} size={30} /><span className="wallet-token-trigger-main"><span className="wallet-token-trigger-code">{selectedToken.code} + USDT</span><span className="wallet-token-trigger-name">{poolReady ? `池价 $${formatPrice(poolPrice)}` : '暂无可用池子'}</span></span></> : <span className="wallet-token-trigger-placeholder">选择流动性池</span>}
            <span className="wallet-token-trigger-chevron">更换 ⌄</span>
          </button>

          {selectedToken && poolReady ? <>
            {liquidityMode === 'add' ? <>
              <p className="wallet-workspace-caption">两种资产按池内比例配对，填写一项即可自动计算另一项。</p>
              <div className="wallet-amount-card">
                <div className="wallet-amount-label"><label htmlFor="wallet-liquidity-usdt">投入 USDT</label><span>可用 {formatNumber(walletUsdt, 2)}</span></div>
                <div className="wallet-amount-entry"><input id="wallet-liquidity-usdt" className="wallet-input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={liquidityTokenInput !== null ? String(Number(amount.toPrecision(12))) : amountInput} onChange={e => { setAmountInput(e.target.value); setLiquidityTokenInput(null); setReceipt(null); }} data-testid="wallet-liquidity-input" /><span className="wallet-currency"><TokenLogo code="USDT" size={22} /><strong>USDT</strong></span></div>
              </div>
              <div className="wallet-pair-plus" aria-hidden="true">+</div>
              <div className="wallet-amount-card">
                <div className="wallet-amount-label"><label htmlFor="wallet-liquidity-token-amount">配对代币</label><span>可用 {formatNumber(tokenAvailable, 6)}</span></div>
                <div className="wallet-amount-entry"><input id="wallet-liquidity-token-amount" className="wallet-input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={liquidityTokenInput ?? (amountInput ? String(Number(liquidityTokenAmount.toPrecision(12))) : '')} onChange={e => { const value = Number(e.target.value); setLiquidityTokenInput(e.target.value); setAmountInput(e.target.value === '' ? '' : String(value * poolPrice)); setReceipt(null); }} data-testid="wallet-liquidity-token-input" /><span className="wallet-currency"><TokenLogo code={selectedToken.code} size={22} /><strong>{selectedToken.code}</strong></span></div>
                {(lockedCollateralByToken[selectedToken.id] || 0) > 0 && <span className="wallet-amount-fiat">已排除质押中的 {formatNumber(lockedCollateralByToken[selectedToken.id], 6)} {selectedToken.code}</span>}
              </div>
              <WalletAmountShortcuts prefix="wallet-liquidity" percent={liquidityPercent} onChange={applyLiquidityPercent} disabled={liquidityMax <= 0} />
              <div className="wallet-quote-summary"><div><span>最大可配对</span><strong data-testid="wallet-liquidity-max">{formatNumber(liquidityMax, 6)} USDT + {formatNumber(liquidityMax / poolPrice, 6)} {selectedToken.code}</strong></div><div><span>添加后池份额</span><strong>{lpShareAfter.toFixed(4)}%</strong></div></div>
              {liquidityError && <div className="wallet-inline-notice" role="status">{liquidityError}</div>}
              {liquidityMax <= 0 && <div className="wallet-inline-notice wallet-funding-prompt"><span>{walletUsdt <= 0 ? '需要钱包 USDT 与配对代币' : `还需要可用 ${selectedToken.code} 才能配对`}</span><button type="button" onClick={() => { setSwapDirection('buy'); openView('swap'); }}>去兑换 ›</button></div>}
              <div className="wallet-submit-area"><button type="button" className="wallet-confirm-btn" disabled={!canAdd || isFastForwarding} onClick={submitLiquidity} data-testid="wallet-liquidity-add">{amount <= 0 || !Number.isFinite(amount) ? '输入投入数量' : liquidityError || '确认添加流动性'}</button><span className="wallet-operation-footnote">同时扣除两种资产 · 未确认前不扣款</span></div>
            </> : <>
              {walletLp && walletLp.shares > 0 ? <>
                <div className="wallet-lp-position"><span>我的流动性</span><strong>{formatNumber(walletLp.tokenAmount, 6)} {selectedToken.code}</strong><strong>+ {formatNumber(walletLp.quoteAmount, 6)} USDT</strong><span>选择撤出比例，确认后两种资产返还钱包</span></div>
                <div className="wallet-remove-control"><label htmlFor="wallet-remove-slider">撤出比例</label><output data-testid="wallet-remove-percent">{removePercent}%</output><input id="wallet-remove-slider" className="wallet-percent-range" type="range" min={1} max={100} step={1} value={removePercent} onChange={e => { setRemovePercent(Number(e.target.value)); setReceipt(null); }} data-testid="wallet-remove-slider" /><div className="wallet-percent-presets">{[25, 50, 75, 100].map(percent => <button type="button" key={percent} className={`wallet-percent-preset ${removePercent === percent ? 'selected' : ''}`} aria-pressed={removePercent === percent} onClick={() => { setRemovePercent(percent); setReceipt(null); }} data-testid={`wallet-remove-${percent}`}>{percent === 100 ? '全部' : `${percent}%`}</button>)}</div></div>
                <div className="wallet-withdraw-preview" data-testid="wallet-remove-preview"><span>预计返还钱包</span><div><TokenLogo code={selectedToken.code} size={24} /><strong data-testid="wallet-remove-token-output">{formatNumber(removeTokenAmount, 6)}</strong><span>{selectedToken.code}</span></div><div><TokenLogo code="USDT" size={24} /><strong data-testid="wallet-remove-usdt-output">{formatNumber(removeQuoteAmount, 6)}</strong><span>USDT</span></div></div>
                <div className="wallet-submit-area"><button type="button" className="wallet-confirm-btn" disabled={isFastForwarding || !(removeTokenAmount > 0 && removeQuoteAmount > 0)} onClick={submitRemove} data-testid="wallet-liquidity-remove-confirm">{removePercent === 100 ? '确认全部移除' : `确认移除 ${removePercent}% 流动性`}</button><span className="wallet-operation-footnote">选择比例仅作预览 · 确认后才撤出</span></div>
              </> : <div className="wallet-pool-empty"><span aria-hidden="true">◉</span><strong>还没有这个池子的流动性</strong><p>{myLiquidity.length > 0 ? '点击上方「我的池子」快速切换已有仓位。' : '先添加一对资产，即可在这里管理和撤出。'}</p><button type="button" className="wallet-secondary-action" onClick={() => setLiquidityMode('add')}>去添加流动性</button></div>}
            </>}
            <details className="wallet-pool-details"><summary>池子信息与说明 <span>⌄</span></summary><div><span>池内 {selectedToken.code}</span><strong>{formatNumber(selectedPool.tokenReserve, 4)}</strong></div><div><span>池内 USDT</span><strong>{formatNumber(selectedPool.quoteReserve, 2)}</strong></div><p>按游戏现有 LP 记录撤出双资产；资金进入池子后不再计入钱包可用余额。池价波动可能带来资产价值变化。</p></details>
          </> : <div className="wallet-pool-empty"><strong>请选择一个可用流动性池</strong><p>选择后即可查看配对数量与钱包余额。</p><button type="button" className="wallet-secondary-action" onClick={() => setPickerMode('liquidity')}>选择池子</button></div>}
        </div>
      )}

      {view === 'transfer' && (
        <div className="wallet-page">
          <div className="wallet-swap-side-tabs">
            <button className={`wallet-side-tab ${transferDirection === 'cexToWallet' ? 'active' : ''}`} onClick={() => setTransferDirection('cexToWallet')}>提币（CEX → 钱包）</button>
            <button className={`wallet-side-tab ${transferDirection === 'walletToCex' ? 'active' : ''}`} onClick={() => setTransferDirection('walletToCex')}>充值（钱包 → CEX）</button>
          </div>

          <div className="wallet-swap-side-tabs">
            <button className={`wallet-side-tab ${transferAsset === 'usdt' ? 'active' : ''}`} onClick={() => setTransferAsset('usdt')}>USDT</button>
            <button className={`wallet-side-tab ${transferAsset === 'token' ? 'active' : ''}`} onClick={() => setTransferAsset('token')}>代币</button>
          </div>

          {transferAsset === 'token' && (
            <button className="wallet-token-trigger" onClick={() => setPickerMode('transfer')} data-testid="wallet-transfer-token">
              {selectedToken ? (
                <>
                  <TokenLogo code={selectedToken.code} size={28} />
                  <span className="wallet-token-trigger-main">
                    <span className="wallet-token-trigger-code">{selectedToken.code}</span>
                    <span className="wallet-token-trigger-name">{selectedToken.name}</span>
                  </span>
                </>
              ) : (
                <span className="wallet-token-trigger-placeholder">选择代币</span>
              )}
              <span className="wallet-token-trigger-chevron">⌄</span>
            </button>
          )}

          <div className="wallet-field-card">
            <div className="wallet-field-head">
              <span>数量</span>
              <span className="wallet-field-hint">
                {transferAsset === 'usdt'
                  ? (transferDirection === 'cexToWallet' ? `CEX 可用 ${formatNumber(cexUsdtAvailable, 2)} USDT` : `钱包可用 ${formatNumber(walletUsdt, 2)} USDT`)
                  : (transferDirection === 'cexToWallet'
                    ? `CEX 持仓 ${formatNumber(selectedToken ? getCexTokenAvailable(selectedToken.id) : 0, 6)}`
                    : `钱包可用 ${formatNumber(selectedToken ? getWalletAvailableToken(selectedToken.id) : 0, 6)}`)}
              </span>
            </div>
            <div className="wallet-field-body">
              <input
                className="wallet-input"
                inputMode="decimal"
                placeholder="0.00"
                value={amountInput}
                onChange={e => setAmountInput(e.target.value)}
                data-testid="wallet-transfer-input"
              />
              <span className="wallet-field-unit">{transferAsset === 'usdt' ? 'USDT' : (selectedToken?.code || '--')}</span>
            </div>
          </div>

          <div className="wallet-percent-slider">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={transferPercent}
              onChange={event => applyTransferPercent(parseInt(event.target.value, 10) || 0)}
              className="wallet-percent-range"
              data-testid="wallet-transfer-slider"
            />
            <div className="wallet-percent-presets">
              {[25, 50, 75, 100].map(percent => (
                <button
                  key={percent}
                  className="wallet-percent-preset"
                  onClick={() => applyTransferPercent(percent)}
                  data-testid={`wallet-transfer-preset-${percent}`}
                >
                  {percent}%
                </button>
              ))}
            </div>
          </div>

          <div className="wallet-fee-hint">充提币将在下一回合到账（延迟结算，防止瞬时套利）</div>

          <button
            className="wallet-confirm-btn"
            data-testid="wallet-transfer-confirm"
            onClick={() => {
              const ok = onTransfer(transferAsset, transferAsset === 'token' ? selectedToken?.id : undefined, transferDirection, amount);
              if (ok) resetForm();
            }}
          >
            {transferDirection === 'cexToWallet' ? '提交提币' : '提交充值'}
          </button>

          {pendingTransfers.length > 0 && (
            <div className="wallet-pending-card">
              <div className="wallet-section-title">在途记录</div>
              {pendingTransfers.map(item => {
                const token = item.tokenId ? tokenMap.get(item.tokenId) : null;
                return (
                  <div className="wallet-pending-row" key={item.id}>
                    <span className={`wallet-pending-dir ${item.direction}`}>{item.direction === 'cexToWallet' ? '提币' : '充值'}</span>
                    <span className="wallet-pending-asset">{item.assetKind === 'usdt' ? 'USDT' : token?.code}</span>
                    <span className="wallet-pending-amount">{formatNumber(item.amount, item.assetKind === 'usdt' ? 2 : 6)}</span>
                    <span className="wallet-pending-round">第 {item.settleRound} 回合到账（当前第 {currentRound} 回合）</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <WalletTokenPicker
        open={pickerMode !== null}
        title={pickerMode === 'swap' ? '选择代币' : pickerMode === 'liquidity' ? '选择流动性池代币' : '选择代币'}
        options={pickerOptions}
        selectedTokenId={selectedTokenId}
        onSelect={selectToken}
        onClose={() => setPickerMode(null)}
      />
    </div>
  );
}
