
import type { Candle, Token } from '../../types';
import { useRenderProbe } from '../../lib/renderProbe';
import { computeToken24hTurnover } from '../../logic/delist';
import { getSpotSuspendEventTitle, isHackedToken } from '../../data/tokenMeta';
import { formatNumber, formatPrice } from '../../utils/format';
import { TokenLogo } from '../common/TokenLogo';
import { memoIgnoringCallbacks } from '../../lib/memo';

type MarketSortField = 'name' | 'price' | 'change' | 'marketCap' | 'volume';
type MarketSortDirection = 'asc' | 'desc';

const SORT_FIELDS: { field: MarketSortField; label: string }[] = [
  { field: 'name', label: '代币' },
  { field: 'price', label: '最新价格' },
  { field: 'change', label: '24h涨跌' },
];

interface MarketTokenListProps {
  tokens: Token[];
  marketSectorTab: string;
  marketSearchQuery: string;
  marketSortField: MarketSortField;
  marketSortDirection: MarketSortDirection;
  onSortChange: (field: MarketSortField) => void;
  selectedTokenId: string;
  onSelectToken: (tokenId: string) => void;
  currentRound: number;
  tokenCandlesMap: Record<string, Candle[]>;
  getToken24hChange: (token: Token) => number;
  getTierDisplay: (token: Token) => { label: string; color: string };
}

function MarketTokenListInner({
  tokens,
  marketSectorTab,
  marketSearchQuery,
  marketSortField,
  marketSortDirection,
  onSortChange,
  selectedTokenId,
  onSelectToken,
  currentRound,
  tokenCandlesMap,
  getToken24hChange,
  getTierDisplay,
}: MarketTokenListProps) {
  useRenderProbe('MarketTokenList');
  return (
    <div className="market-token-list-full">
      <div className="market-token-list-header">
        {SORT_FIELDS.map(({ field, label }) => (
          <span
            key={field}
            className="market-header-sortable"
            onClick={() => onSortChange(field)}
          >
            {label}
            {marketSortField === field && (
              <span className="sort-indicator">{marketSortDirection === 'asc' ? ' ↑' : ' ↓'}</span>
            )}
          </span>
        ))}
      </div>
      <div className="market-token-list-content">
        {/* 市场代币列表 */}
        {[...tokens]
          .filter(token => marketSectorTab === 'all' || token.sector === marketSectorTab)
          .filter(token => {
            if (!marketSearchQuery) return true;
            const query = marketSearchQuery.toLowerCase();
            return token.code.toLowerCase().includes(query) ||
                   token.name.toLowerCase().includes(query);
          })
          .slice()
          .map(token => {
            const change24hDisplay = getToken24hChange(token);
            // 计算24小时成交额（成交金额 = 成交量 × 价格，不是成交数量）
            const tokenCandles = tokenCandlesMap[token.id] || [];
            const volume24h = computeToken24hTurnover(tokenCandles);
            return { token, change24hDisplay, volume24h };
          })
          .sort((a, b) => {
            let comparison = 0;
            switch (marketSortField) {
              case 'name':
                comparison = a.token.code.localeCompare(b.token.code);
                break;
              case 'price':
                comparison = a.token.currentPrice - b.token.currentPrice;
                break;
              case 'change':
                comparison = a.change24hDisplay - b.change24hDisplay;
                break;
              case 'marketCap':
                comparison = a.token.marketCap - b.token.marketCap;
                break;
              case 'volume':
                comparison = a.volume24h - b.volume24h;
                break;
            }
            return marketSortDirection === 'asc' ? comparison : -comparison;
          })
          .map(({ token, change24hDisplay, volume24h }) => {
            const tierDisplay = getTierDisplay(token);
            const tierColor = tierDisplay.color;
            const tierLabel = tierDisplay.label;

            return (
              <div
                key={token.id}
                className={`market-token-row ${token.id === selectedTokenId ? 'active' : ''}`}
                onClick={() => onSelectToken(token.id)}
              >
                <div className="market-token-main">
                  <TokenLogo code={token.code} tierColor={tierColor} />
                  <span className="market-token-names">
                    <span className="market-token-code">{token.code}</span>
                    <span className="market-token-sub">
                      {token.name}
                      <span className="market-token-sub-dot">·</span>
                      {tierLabel}
                      <span className="market-token-sub-dot">·</span>
                      市值 ${formatNumber(token.marketCap)}
                    </span>
                  </span>
                  {isHackedToken(token, currentRound) && (
                    <span className="hack-tag" title={`${getSpotSuspendEventTitle(token)}中，现货交易暂停`}>⚡停牌</span>
                  )}
                </div>
                <span className={`market-token-price ${change24hDisplay >= 0 ? 'up' : 'down'}`}>
                  ${formatPrice(token.currentPrice)}
                </span>
                <span className={`market-token-change ${change24hDisplay >= 0 ? 'up' : 'down'}`}>
                  {change24hDisplay >= 0 ? '+' : ''}{change24hDisplay.toFixed(2)}%
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/** Stage 3 渲染隔离：重组件只在 props 变化时重渲染 */
export const MarketTokenList = memoIgnoringCallbacks(MarketTokenListInner);
