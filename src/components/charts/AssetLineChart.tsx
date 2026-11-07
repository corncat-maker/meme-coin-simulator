
import { formatNumber } from '../../utils/format';
import { useRenderProbe } from '../../lib/renderProbe';
import { memoIgnoringCallbacks } from '../../lib/memo';

export type AssetLineChartVariant = 'home' | 'assets';

interface AssetLineChartProps {
  variant: AssetLineChartVariant;
  data: number[];
  currentRound: number;
  isDarkMode: boolean;
  onClose: () => void;
}

const VARIANT_CLASSES = {
  home: {
    container: 'asset-chart-container',
    header: 'asset-chart-header',
    chart: 'asset-chart',
  },
  assets: {
    container: 'assets-chart-container',
    header: 'assets-chart-header',
    chart: 'assets-chart',
  },
} as const;

function AssetLineChartInner({
  variant,
  data,
  currentRound,
  isDarkMode,
  onClose,
}: AssetLineChartProps) {
  useRenderProbe('AssetLineChart');
  const cls = VARIANT_CLASSES[variant];

  return (
    <div className={cls.container}>
      <div className={cls.header}>
        <span className="chart-title">近{data.length}回合总资产变化</span>
        <button className="chart-close" onClick={onClose}>✕</button>
      </div>
      <div className={cls.chart}>
        {/* 左侧Y轴金额刻度 */}
        <div className="chart-y-axis">
          {(() => {
            const min = Math.min(...data);
            const max = Math.max(...data);
            const range = max - min || 1;
            // 生成5个刻度值
            const scaleValues = [];
            for (let i = 0; i <= 4; i++) {
              scaleValues.push(min + (range * i) / 4);
            }
            return scaleValues.reverse().map((val, i) => (
              <span key={i} className="y-axis-label">${formatNumber(val)}</span>
            ));
          })()}
        </div>
        {/* SVG图表区域 */}
        <div className="chart-svg-wrapper">
          <svg width="100%" height="120" viewBox="0 0 295 120" preserveAspectRatio="xMidYMid meet">
            {(() => {
              const min = Math.min(...data);
              const max = Math.max(...data);
              const range = max - min || 1;
              const chartHeight = 100; // 图表高度
              const chartTop = 10; // 顶部边距
              const chartBottom = 110; // 底部位置
              const chartLeft = 15; // 左边距（避免被Y轴刻度遮挡）
              const chartRight = 295; // 右边界

              // 生成折线点
              const points = data.map((val, i) => {
                const x = chartLeft + (i / (data.length - 1)) * (chartRight - chartLeft);
                const y = chartBottom - ((val - min) / range) * chartHeight;
                return `${x},${y}`;
              }).join(' ');

              const lastVal = data[data.length - 1];
              const firstVal = data[0];
              const lineColor = lastVal >= firstVal ? 'var(--up-color)' : 'var(--down-color)';

              // 生成Y轴网格线
              const yGridLines = [];
              for (let i = 0; i <= 4; i++) {
                const y = chartBottom - (i / 4) * chartHeight;
                yGridLines.push(
                  <line
                    key={`ygrid-${i}`}
                    x1={chartLeft}
                    y1={y}
                    x2={chartRight}
                    y2={y}
                    stroke={isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                    strokeWidth="1"
                  />
                );
              }

              // 生成X轴时间刻度（显示时间格式 xx:xx）
              const xLabels = [];
              const labelCount = Math.min(data.length, 6); // 最多显示6个刻度
              const step = Math.max(1, Math.floor((data.length - 1) / (labelCount - 1)));
              for (let i = 0; i < data.length; i += step) {
                const x = chartLeft + (i / (data.length - 1)) * (chartRight - chartLeft);
                const roundNum = currentRound - data.length + i + 1;
                // 计算时间：每回合代表1小时
                const hour = roundNum % 24;
                const timeStr = `${hour.toString().padStart(2, '0')}:00`;
                xLabels.push(
                  <text
                    key={`xlabel-${i}`}
                    x={x}
                    y={chartBottom + 8}
                    textAnchor="middle"
                    fontSize="9"
                    fill={isDarkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'}
                  >
                    {timeStr}
                  </text>
                );
              }

              return (
                <>
                  {/* Y轴网格线 */}
                  {yGridLines}
                  {/* 折线 */}
                  <polyline
                    fill="none"
                    stroke={lineColor}
                    strokeWidth="2"
                    points={points}
                  />
                  {/* 数据点 */}
                  {data.map((val, i) => {
                    const x = chartLeft + (i / (data.length - 1)) * (chartRight - chartLeft);
                    const y = chartBottom - ((val - min) / range) * chartHeight;
                    return (
                      <circle
                        key={i}
                        cx={x}
                        cy={y}
                        r="2"
                        fill={lineColor}
                      />
                    );
                  })}
                  {/* X轴时间刻度 */}
                  {xLabels}
                </>
              );
            })()}
          </svg>
        </div>
      </div>
    </div>
  );
}

/** Stage 3 渲染隔离：重组件只在 props 变化时重渲染 */
export const AssetLineChart = memoIgnoringCallbacks(AssetLineChartInner);
