
import type { FuturesPosition } from '../../types';
import { useRenderProbe } from '../../lib/renderProbe';
import { formatNumber, formatPrice } from '../../utils/format';
import { memoIgnoringCallbacks } from '../../lib/memo';

interface PositionCardProps {
  pos: FuturesPosition;
  tokenCode?: string;
  isDelistPending: boolean;
  /** 保证金比率；null 表示 ∞ */
  marginRatio: number | null;
  markPrice: number;
  displayLiquidationPrice: number;
  showCloseButton?: boolean;
  onClosePosition?: () => void;
  onClick?: () => void;
  rootClassName?: string;
}

function PositionCardInner({
  pos,
  tokenCode,
  isDelistPending,
  marginRatio,
  markPrice,
  displayLiquidationPrice,
  showCloseButton,
  onClosePosition,
  onClick,
  rootClassName,
}: PositionCardProps) {
  useRenderProbe('PositionCard');
  return (
    <div className={rootClassName} onClick={onClick}>
      {/* 第一行：多/空标签 + 交易对名称 + 永续标签 + 杠杆倍数 */}
      <div className="position-row-1">
        <div className="position-side-info">
          <span className={`position-side-badge ${pos.side}`}>
            {pos.side === 'long' ? '多' : '空'}
          </span>
          <span className="position-token-name">{tokenCode}USDT</span>
          <span className="position-perpetual-tag">永续</span>
          {isDelistPending && (
            <span className="position-delist-tag">即将下架</span>
          )}
          <span className={`position-margin-mode-tag ${pos.marginMode === 'isolated' ? 'isolated' : 'cross'}`}>
            {pos.marginMode === 'isolated' ? '逐仓' : '全仓'}
          </span>
          <span className="position-leverage-tag">{pos.leverage}x</span>
        </div>
        {showCloseButton && (
          <button className="close-pos-btn-bar" onClick={onClosePosition}>
            平仓
          </button>
        )}
      </div>

      {/* 第二行：盈亏（左）+ 盈亏率（右） */}
      <div className="position-row-2">
        <div className="position-field">
          <div className="position-field-label">盈亏:</div>
          <div className={`position-field-value ${pos.unrealizedPnl >= 0 ? 'up' : 'down'}`}>
            {pos.unrealizedPnl >= 0 ? '+' : ''}{formatNumber(pos.unrealizedPnl, 2)}
          </div>
        </div>
        <div className="position-field">
          <div className="position-field-label">盈利率:</div>
          <div className={`position-field-value ${pos.roe >= 0 ? 'up' : 'down'}`}>
            {pos.roe >= 0 ? '+' : ''}{pos.roe.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* 第三行：持仓数量（左）+ 保证金（中）+ 保证金比率（右） */}
      <div className="position-row-3">
        <div className="position-field">
          <div className="position-field-label">持仓数量:</div>
          <div className="position-field-value">{formatNumber(pos.quantity, 2)}</div>
        </div>
        <div className="position-field">
          <div className="position-field-label">保证金:</div>
          <div className="position-field-value">${formatNumber(pos.margin, 0)}</div>
        </div>
        <div className="position-field">
          <div className="position-field-label">保证金比率:</div>
          <div className="position-field-value">
            {marginRatio === null ? '∞' : formatNumber(marginRatio, 0) + '%'}
          </div>
        </div>
      </div>

      {/* 第四行：开仓价格 + 标记价格 + 强平价格 */}
      <div className="position-row-4">
        <div className="position-field">
          <div className="position-field-label">开仓价格:</div>
          <div className="position-field-value">${formatPrice(pos.entryPrice)}</div>
        </div>
        <div className="position-field">
          <div className="position-field-label">标记价格:</div>
          <div className="position-field-value">${formatPrice(markPrice)}</div>
        </div>
        <div className="position-field">
          <div className="position-field-label">强平价格:</div>
          <div className="position-field-value liquidation">${formatPrice(displayLiquidationPrice)}</div>
        </div>
      </div>
    </div>
  );
}

/** Stage 3 渲染隔离：重组件只在 props 变化时重渲染 */
export const PositionCard = memoIgnoringCallbacks(PositionCardInner);
