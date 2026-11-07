/**
 * 盘口面板（Stage 3 · 第三批次 · props 稳定化）
 *
 * 从 App 内联 JSX 抽离：现货盘口 / 合约盘口。抽离后 App 的其他 state 更新
 * （弹窗、toast、历史数组等）不再触发盘口重渲染，memo 比较忽略回调引用。
 */
import type { OrderBookEntry, Level2OrderBook, FuturesOrderBook } from '../../types';
import { useRenderProbe } from '../../lib/renderProbe';
import { computeDepthPercent, formatNumber, formatPrice } from '../../utils/format';
import { memoIgnoringCallbacks } from '../../lib/memo';
import { useMarketValue, type PriceFlash as StorePriceFlash } from '../../store/marketStore';

export type PriceFlash = StorePriceFlash;

function currentPriceKey(priceFlash: PriceFlash | null): string {
  return priceFlash ? `${priceFlash.dir}-${priceFlash.tick}` : 'stable';
}

function OrderBookRows({
  rows,
  side,
  fromBottom,
  showPlayerBadge,
}: {
  rows: OrderBookEntry[];
  side: 'ask' | 'bid';
  fromBottom?: boolean;
  showPlayerBadge?: boolean;
}) {
  const pcts = computeDepthPercent(rows, fromBottom ? { fromBottom: true } : undefined);
  return (
    <div className={`orderbook-section ${side === 'ask' ? 'asks' : 'bids'}`}>
      <div className="orderbook-header-row">
        <span>价格</span>
        <span>金额</span>
      </div>
      {rows.map((row, i) => (
        <div
          key={`${side}-${i}`}
          className={`orderbook-row ${side} ${showPlayerBadge && row.isPlayer ? 'player-order' : ''}`}
        >
          <div className={`ob-depth-bar ${side}`} style={{ width: `${pcts[i]}%` }} />
          <span className={`price ${side === 'ask' ? 'down' : 'up'}`}>
            {showPlayerBadge && row.isPlayer && (
              <span className="player-badge" title="我的订单">★</span>
            )}
            ${formatPrice(row.price)}
          </span>
          <span className="qty">{formatNumber(row.total)}</span>
        </div>
      ))}
    </div>
  );
}

export interface SpotOrderBookPanelProps {
  book: Level2OrderBook | null;
  change24h: number;
  onOpenFull: () => void;
}

function SpotOrderBookPanelInner({ book, change24h, onOpenFull }: SpotOrderBookPanelProps) {
  useRenderProbe('SpotOrderBookPanel');
  const priceFlash = useMarketValue('priceFlash');
  return (
    <div className="trade-right-panel trade-orderbook-panel">
      <div className="panel-header">
        <span className="panel-title">盘口</span>
      </div>
      {book && (
        <>
          <div className="orderbook-mode-label">
            <span className="mode-tag cex">📋 限价单</span>
          </div>
          <OrderBookRows
            rows={[...book.asks].reverse().slice(0, 5)}
            side="ask"
            fromBottom
            showPlayerBadge
          />
          <div
            className="orderbook-current orderbook-clickable"
            onClick={onOpenFull}
            title="点击查看完整盘口"
          >
            <span
              key={currentPriceKey(priceFlash)}
              className={`current-price ${change24h >= 0 ? 'up' : 'down'} ${priceFlash ? `price-flash-${priceFlash.dir}` : ''}`}
            >
              ${formatPrice(book.lastPrice)}
            </span>
            <span className={`price-change ${change24h >= 0 ? 'up' : 'down'}`}>
              {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
            </span>
          </div>
          <OrderBookRows rows={book.bids.slice(0, 5)} side="bid" showPlayerBadge />
        </>
      )}
    </div>
  );
}

export const SpotOrderBookPanel = memoIgnoringCallbacks(SpotOrderBookPanelInner);

export interface FuturesOrderBookPanelProps {
  book: FuturesOrderBook | null;
  change24h: number;
  leverage: number;
  fundingIntervalHint: string | null;
  onOpenFull: () => void;
}

function FuturesOrderBookPanelInner({
  book,
  change24h,
  leverage,
  fundingIntervalHint,
  onOpenFull,
}: FuturesOrderBookPanelProps) {
  useRenderProbe('FuturesOrderBookPanel');
  const priceFlash = useMarketValue('priceFlash');
  return (
    <div className="trade-right-panel trade-orderbook-panel">
      <div className="panel-header">
        <span className="panel-title">合约盘口 ({leverage}x)</span>
      </div>
      {book && (
        <>
          <div className="funding-rate-bar">
            <span className="funding-label">费率</span>
            <span className={`funding-value ${book.fundingRate >= 0 ? 'up' : 'down'}`}>
              {(book.fundingRate * 100).toFixed(2)}%
            </span>
            {fundingIntervalHint && <span className="funding-hint">{fundingIntervalHint}</span>}
          </div>
          <OrderBookRows rows={[...book.asks].reverse().slice(0, 5)} side="ask" fromBottom />
          <div
            className="orderbook-current orderbook-clickable"
            onClick={onOpenFull}
            title="点击查看完整盘口"
          >
            <div className="current-price-row">
              <span
                key={currentPriceKey(priceFlash)}
                className={`current-price ${change24h >= 0 ? 'up' : 'down'} ${priceFlash ? `price-flash-${priceFlash.dir}` : ''}`}
              >
                ${formatPrice(book.bids[0]?.price || book.lastPrice)}
              </span>
              <span className={`price-change ${change24h >= 0 ? 'up' : 'down'}`}>
                {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
              </span>
            </div>
            <div className="mark-price-row">
              <span className="mark-price-label">标记</span>
              <span className="mark-price-value">${formatPrice(book.markPrice)}</span>
            </div>
          </div>
          <OrderBookRows rows={book.bids.slice(0, 5)} side="bid" />
        </>
      )}
    </div>
  );
}

export const FuturesOrderBookPanel = memoIgnoringCallbacks(FuturesOrderBookPanelInner);
