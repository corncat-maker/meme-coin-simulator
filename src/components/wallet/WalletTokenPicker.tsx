// 链上钱包通用代币选择器：底部弹层 + 搜索框 + 现代列表 UI
import { useEffect, useMemo, useState } from 'react';
import type { Token } from '../../types';
import { TokenLogo } from '../common/TokenLogo';
import { formatNumber } from '../../utils/format';

export interface WalletTokenOption {
  token: Token;
  /** 用户可用/持有数量（右侧主数字） */
  amount?: number;
  /** 估值（右侧副数字） */
  usdValue?: number;
  /** 右侧附加标签（如 CEX / 钱包 / TVL） */
  amountLabel?: string;
  /** 右侧主文本（优先级高于 amount，如价格 $9.28） */
  primaryLabel?: string;
  /** 右侧副文本（优先级高于 usdValue，如 TVL / 备注） */
  secondaryLabel?: string;
  /** 左侧附加说明（如池子 TVL） */
  note?: string;
  disabled?: boolean;
}

interface WalletTokenPickerProps {
  open: boolean;
  title: string;
  options: WalletTokenOption[];
  selectedTokenId?: string;
  onSelect: (tokenId: string) => void;
  onClose: () => void;
}

export function WalletTokenPicker({ open, title, options, selectedTokenId, onSelect, onClose }: WalletTokenPickerProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const filteredOptions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return options;
    return options.filter(option => option.token.code.toLowerCase().includes(keyword) || option.token.name.toLowerCase().includes(keyword));
  }, [options, query]);

  if (!open) return null;

  return (
    <div className="wallet-picker-mask" data-testid="wallet-token-picker" onClick={onClose}>
      <div className="wallet-picker-sheet" onClick={event => event.stopPropagation()}>
        <div className="wallet-picker-handle" />
        <div className="wallet-picker-head">
          <span className="wallet-picker-title">{title}</span>
          <button className="wallet-picker-close" onClick={onClose} data-testid="wallet-token-picker-close">×</button>
        </div>
        <div className="wallet-picker-search">
          <span className="wallet-picker-search-icon">🔍</span>
          <input
            className="wallet-picker-search-input"
            placeholder="搜索代币名称或代码"
            value={query}
            onChange={event => setQuery(event.target.value)}
            data-testid="wallet-token-picker-search"
          />
          {query.length > 0 && (
            <button className="wallet-picker-search-clear" onClick={() => setQuery('')} data-testid="wallet-picker-clear">×</button>
          )}
        </div>
        <div className="wallet-picker-list">
          {filteredOptions.length === 0 && <div className="wallet-picker-empty">未找到匹配的代币</div>}
          {filteredOptions.map(option => (
            <button
              key={option.token.id}
              className={`wallet-picker-row ${option.token.id === selectedTokenId ? 'active' : ''}`}
              disabled={option.disabled}
              onClick={() => { onSelect(option.token.id); onClose(); }}
              data-testid={`wallet-token-option-${option.token.code}`}
            >
              <TokenLogo code={option.token.code} size={30} />
              <span className="wallet-picker-token">
                <span className="wallet-picker-code">{option.token.code}</span>
                <span className="wallet-picker-name">
                  {option.token.name}{option.note ? ` · ${option.note}` : ''}
                </span>
              </span>
              <span className="wallet-picker-right">
                {option.primaryLabel ? (
                  <span className="wallet-picker-amount">{option.primaryLabel}</span>
                ) : option.amount !== undefined ? (
                  <span className="wallet-picker-amount">{formatNumber(option.amount, option.amount >= 1000 ? 2 : 6)}</span>
                ) : null}
                {option.secondaryLabel ? (
                  <span className="wallet-picker-usd">{option.secondaryLabel}</span>
                ) : option.usdValue !== undefined && option.usdValue > 0 ? (
                  <span className="wallet-picker-usd">${formatNumber(option.usdValue, 2)}</span>
                ) : null}
                {option.amountLabel && <span className="wallet-picker-label">{option.amountLabel}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
