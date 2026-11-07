/**
 * 资产卡（Stage 3 · 第三批次 · 资产区抽离）
 *
 * 首页顶部「总资产」区块：总资产 / 可用 / 盈亏 / ROI。
 * 只接收基础类型 props，回调由 memoIgnoringCallbacks 隔离，
 * 回合内其它 state 更新（盘口、K线、弹窗等）不再带动资产卡重渲染。
 */
import { useRenderProbe } from '../../lib/renderProbe';
import { formatNumber } from '../../utils/format';
import { memoIgnoringCallbacks } from '../../lib/memo';

export interface AssetCardProps {
  totalAsset: number;
  initialCapital: number;
  availableCapital: number;
  roi: number;
  onToggleChart: () => void;
  onOpenSettings: () => void;
}

function AssetCardInner({
  totalAsset,
  initialCapital,
  availableCapital,
  roi,
  onToggleChart,
  onOpenSettings,
}: AssetCardProps) {
  useRenderProbe('AssetCard');
  const pnlUp = totalAsset - initialCapital >= 0;

  return (
    <>
      <div className="home-title-bar">
        <span className="home-title">总资产</span>
        <button className="home-settings-btn" onClick={onOpenSettings} data-testid="home-settings-btn">
          ⚙️
        </button>
      </div>
      <div className="total-asset-display" onClick={onToggleChart} data-testid="total-asset-click">
        <span className={`total-asset-value ${pnlUp ? 'up' : 'down'}`}>
          ${formatNumber(totalAsset)}
        </span>
        <span className="total-asset-hint">点击查看近24回合变化</span>
      </div>
      <div className="total-asset-detail">
        <span className="detail-item">
          <span className="detail-label">可用</span>
          <span className="detail-value">${formatNumber(availableCapital)}</span>
        </span>
        <span className="detail-item">
          <span className="detail-label">盈亏</span>
          <span className={`detail-value ${pnlUp ? 'up' : 'down'}`}>
            {pnlUp ? '+' : ''}${formatNumber(totalAsset - initialCapital)}
          </span>
        </span>
        <span className="detail-item">
          <span className="detail-label">ROI</span>
          <span className={`detail-value ${roi >= 0 ? 'up' : 'down'}`}>
            {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
          </span>
        </span>
      </div>
    </>
  );
}

export const AssetCard = memoIgnoringCallbacks(AssetCardInner);
