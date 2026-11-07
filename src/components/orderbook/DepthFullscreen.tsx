import type { ReactNode } from 'react';
import type { OrderBookEntry } from '../../types';
import { computeDepthPercent, formatNumber, formatPrice } from '../../utils/format';

interface DepthFullscreenProps {
  chart: ReactNode;
  lastPrice: number;
  highPrice: number;
  lowPrice: number;
  change24h: number;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}

export function DepthFullscreen({
  chart,
  lastPrice,
  highPrice,
  lowPrice,
  change24h,
  bids,
  asks,
}: DepthFullscreenProps) {
  const bidPcts = computeDepthPercent(bids);
  const askPcts = computeDepthPercent(asks);

  return (
    <>
      <div className="depth-chart-fullscreen">{chart}</div>
      <div className="depth-legend">
        <div className="legend-item">
          <span className="legend-color bid"></span>
          <span className="legend-label">买盘</span>
        </div>
        <div className="legend-item">
          <span className="legend-color ask"></span>
          <span className="legend-label">卖盘</span>
        </div>
      </div>
      {/* 盘口详情 - 价格在上方，买盘卖盘并排显示在下方 */}
      <div className="depth-orderbook-container">
        {/* 价格区域 - 在上方 */}
        <div className="depth-price-header">
          <div className="depth-price-main">
            <span className={`depth-current-price ${change24h >= 0 ? 'up' : 'down'}`}>
              ${formatPrice(lastPrice)}
            </span>
          </div>
          <div className="depth-price-range">
            <span className="range-high">高 ${formatPrice(highPrice)}</span>
            <span className="range-separator">·</span>
            <span className="range-low">低 ${formatPrice(lowPrice)}</span>
          </div>
        </div>
        {/* 买盘卖盘并排显示 - 买盘在左，卖盘在右 */}
        <div className="depth-orderbook-sidebyside">
          {/* 左侧：买盘 */}
          <div className="depth-orderbook-section">
            <div className="depth-orderbook-title bids">
              <span>📈 买盘（全部）</span>
              <span className="depth-orderbook-count">{bids.length}档</span>
            </div>
            <div className="depth-orderbook-list">
              {bids.map((bid, i) => (
                <div key={`depth-bid-${i}`} className="depth-orderbook-row bid">
                  <div className="ob-depth-bar bid" style={{ width: `${bidPcts[i]}%` }} />
                  <span className="price up">${formatPrice(bid.price)}</span>
                  <span className="total">{formatNumber(bid.total)}</span>
                </div>
              ))}
            </div>
          </div>
          {/* 右侧：卖盘 */}
          <div className="depth-orderbook-section">
            <div className="depth-orderbook-title asks">
              <span>📉 卖盘（全部）</span>
              <span className="depth-orderbook-count">{asks.length}档</span>
            </div>
            <div className="depth-orderbook-list">
              {asks.map((ask, i) => (
                <div key={`depth-ask-${i}`} className="depth-orderbook-row ask">
                  <div className="ob-depth-bar ask" style={{ width: `${askPcts[i]}%` }} />
                  <span className="price down">${formatPrice(ask.price)}</span>
                  <span className="total">{formatNumber(ask.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
