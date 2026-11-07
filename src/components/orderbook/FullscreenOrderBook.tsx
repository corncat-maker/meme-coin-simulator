
import type { OrderBookEntry } from '../../types';
import { useRenderProbe } from '../../lib/renderProbe';
import { computeDepthPercent, formatNumber, formatPrice } from '../../utils/format';
import { memoIgnoringCallbacks } from '../../lib/memo';

interface FullscreenOrderBookProps {
  asks: OrderBookEntry[];
  bids: OrderBookEntry[];
  lastPrice: number;
  change24h: number;
  variant: 'spot' | 'futures';
  highPrice?: number;
  lowPrice?: number;
  keyPrefix?: string;
  fundingRate?: number;
  markPrice?: number;
  fundingIntervalHours?: number;
}

function FullscreenOrderBookInner({
  asks,
  bids,
  lastPrice,
  change24h,
  variant,
  highPrice,
  lowPrice,
  keyPrefix = '',
  fundingRate,
  markPrice,
  fundingIntervalHours,
}: FullscreenOrderBookProps) {
  useRenderProbe('FullscreenOrderBook');
  const askRows = [...asks].reverse();
  const askPcts = computeDepthPercent(askRows, { fromBottom: true });
  const bidPcts = computeDepthPercent(bids);
  const priceClass = change24h >= 0 ? 'up' : 'down';

  return (
    <>
      {fundingRate !== undefined && markPrice !== undefined && (
        <div className="funding-rate-bar" style={{ margin: '8px 16px' }}>
          <span className="funding-label">资金费率</span>
          <span className={`funding-value ${fundingRate >= 0 ? 'up' : 'down'}`}>
            {(fundingRate * 100).toFixed(4)}%
          </span>
          <span className="funding-hint">标记价: ${formatPrice(markPrice)}</span>
          {fundingIntervalHours !== undefined && (
            <span className="funding-hint">每{fundingIntervalHours}h结算</span>
          )}
        </div>
      )}
      <div className="fullscreen-orderbook-content">
        <div className="fullscreen-orderbook-section">
          <div className="fullscreen-orderbook-title">
            <span>📉 卖盘</span>
          </div>
          {askRows.map((ask, i) => (
            <div key={`${keyPrefix}ask-full-${i}`} className="orderbook-row ask">
              <div className="ob-depth-bar ask" style={{ width: `${askPcts[i]}%` }} />
              <span className="price down">${formatPrice(ask.price)}</span>
              <span className="qty">{formatNumber(ask.total)}</span>
            </div>
          ))}
        </div>
        <div className="fullscreen-orderbook-current">
          <span className={priceClass}>${formatPrice(lastPrice)}</span>
          {variant === 'spot' ? (
            <span className="range">
              最高 ${formatPrice(highPrice ?? 0)} · 最低 ${formatPrice(lowPrice ?? 0)}
            </span>
          ) : (
            <span className={`price-change ${priceClass}`}>
              {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="fullscreen-orderbook-section">
          <div className="fullscreen-orderbook-title">
            <span>📈 买盘</span>
          </div>
          {bids.map((bid, i) => (
            <div key={`${keyPrefix}bid-full-${i}`} className="orderbook-row bid">
              <div className="ob-depth-bar bid" style={{ width: `${bidPcts[i]}%` }} />
              <span className="price up">${formatPrice(bid.price)}</span>
              <span className="qty">{formatNumber(bid.total)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Stage 3 渲染隔离：重组件只在 props 变化时重渲染 */
export const FullscreenOrderBook = memoIgnoringCallbacks(FullscreenOrderBookInner);
