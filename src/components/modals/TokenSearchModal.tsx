import type { Token } from '../../types';
import { formatPrice } from '../../utils/format';

interface TokenSearchModalProps {
  query: string;
  onQueryChange: (query: string) => void;
  tokens: Token[];
  selectedTokenId: string;
  getChange24h: (token: Token) => number;
  onSelect: (tokenId: string) => void;
  onClose: () => void;
}

export function TokenSearchModal({
  query,
  onQueryChange,
  tokens,
  selectedTokenId,
  getChange24h,
  onSelect,
  onClose,
}: TokenSearchModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content token-search-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>选择交易对</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="token-search-content">
          <div className="token-search-input-wrapper">
            <input
              type="text"
              className="token-search-input"
              placeholder="搜索代币名称或代码..."
              value={query}
              onChange={e => onQueryChange(e.target.value)}
              autoFocus
            />
            {query && (
              <button
                className="token-search-clear"
                onClick={() => onQueryChange('')}
              >
                ×
              </button>
            )}
          </div>
          <div className="token-search-list">
            {tokens.length === 0 ? (
              <div className="token-search-empty">未找到匹配的代币</div>
            ) : (
              tokens.map(token => {
                const change24h = getChange24h(token);
                const isSelected = token.id === selectedTokenId;
                return (
                  <div
                    key={token.id}
                    className={`token-search-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => onSelect(token.id)}
                  >
                    <div className="token-item-left">
                      <span className="token-item-code">{token.code}</span>
                      <span className="token-item-name">{token.name}</span>
                    </div>
                    <div className="token-item-right">
                      <span className="token-item-price">${formatPrice(token.currentPrice)}</span>
                      <span className={`token-item-change ${change24h >= 0 ? 'up' : 'down'}`}>
                        {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {!query.trim() && (
            <div className="token-search-hint">按24h成交量排序</div>
          )}
        </div>
      </div>
    </div>
  );
}
