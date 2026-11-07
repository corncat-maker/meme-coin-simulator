// 【第五部分】CEX 库存量图表：24 回合 / 近 7 天折线图 + 抛压预警（红色）
import { useState } from 'react';
import type { CexReserveHistoryPoint } from '../../types';
import {
  buildCexReserveSeries,
  computeCexReservePressure,
  CEX_RESERVE_RANGE_ROUNDS,
  type CexReserveRange,
} from '../../logic/cexReserveChart';

interface CexReserveChartProps {
  tokenCode: string;
  history: CexReserveHistoryPoint[];
  currentRound: number;
}

const compactNumber = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  if (abs >= 1) return value.toFixed(2);
  return value.toFixed(4);
};

export function CexReserveChart({ tokenCode, history, currentRound }: CexReserveChartProps) {
  const [range, setRange] = useState<CexReserveRange>('24h');
  const pressure = computeCexReservePressure(history, currentRound);
  const series = buildCexReserveSeries(history, currentRound, range);
  const rawPoints = series.length > 0 ? series : [{ round: currentRound, reserve: pressure.currentReserve }];
  const points = rawPoints.length === 1 ? [rawPoints[0], rawPoints[0]] : rawPoints;

  const minReserve = Math.min(...points.map(point => point.reserve));
  const maxReserve = Math.max(...points.map(point => point.reserve));
  const span = Math.max(maxReserve - minReserve, Math.max(maxReserve, 1) * 0.02);
  const yMin = Math.max(0, minReserve - span * 0.15);
  const yMax = maxReserve + span * 0.15;

  const width = 320;
  const height = 160;
  const padLeft = 8;
  const padRight = 8;
  const padTop = 10;
  const padBottom = 20;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const pointX = (index: number) => padLeft + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const pointY = (value: number) => padTop + (1 - (value - yMin) / Math.max(1e-9, yMax - yMin)) * plotHeight;

  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${pointX(index).toFixed(2)},${pointY(point.reserve).toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L${pointX(points.length - 1).toFixed(2)},${padTop + plotHeight} L${pointX(0).toFixed(2)},${padTop + plotHeight} Z`;
  const strokeColor = pressure.shouldWarn ? '#f6465d' : '#f0b90b';
  const gradientTop = pressure.shouldWarn ? 'rgba(246,70,93,0.28)' : 'rgba(240,185,11,0.24)';
  const rangeRounds = CEX_RESERVE_RANGE_ROUNDS[range];
  const windowStartRound = Math.max(0, currentRound - rangeRounds + 1);
  const startRound = series.length > 0 ? series[0].round : windowStartRound;
  const gradientId = `cexr-gradient-${tokenCode.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  return (
    <div className="td-chart-card cexr-card" data-testid="cex-reserve-card">
      {pressure.shouldWarn && (
        <div className="cexr-warning" data-testid="cex-reserve-warning">
          据链上数据监测，近期大量代币充值进入CEX，请注意抛压风险
        </div>
      )}
      <div className="td-chart-header">
        <span className="td-chart-title">CEX 库存量</span>
        <div className="cexr-range-tabs">
          {(['24h', '7d'] as CexReserveRange[]).map(option => (
            <button
              key={option}
              className={`cexr-range-tab ${range === option ? 'active' : ''}`}
              onClick={() => setRange(option)}
              data-testid={`cex-reserve-range-${option}`}
            >
              {option === '24h' ? '24回合' : '近7天'}
            </button>
          ))}
        </div>
      </div>
      <div className="cexr-meta">
        <span className="cexr-legend"><i className="cexr-dot" style={{ backgroundColor: strokeColor }} />CEX 库存</span>
        <span className="cexr-current">{tokenCode} · {compactNumber(pressure.currentReserve)}</span>
        <span className={`cexr-growth ${pressure.growthPercent >= 0 ? 'up' : 'down'}`}>
          {pressure.growthPercent >= 0 ? '+' : ''}{pressure.growthPercent.toFixed(2)}% / 24回合
        </span>
      </div>
      <svg className="cexr-svg" viewBox={`0 0 ${width} ${height}`} data-testid="cex-reserve-svg">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={gradientTop} />
            <stop offset="100%" stopColor="rgba(240,185,11,0)" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(ratio => (
          <line
            key={ratio}
            x1={padLeft}
            y1={padTop + ratio * plotHeight}
            x2={width - padRight}
            y2={padTop + ratio * plotHeight}
            className="cexr-grid"
          />
        ))}
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke={strokeColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={pointX(points.length - 1)} cy={pointY(points[points.length - 1].reserve)} r={3.2} fill={strokeColor} />
        <text x={padLeft} y={height - 5} className="cexr-axis-label">第{startRound}回合</text>
        <text x={width - padRight} y={height - 5} textAnchor="end" className="cexr-axis-label">第{currentRound}回合</text>
        <text x={width - padRight} y={padTop + 8} textAnchor="end" className="cexr-axis-label">{compactNumber(yMax)}</text>
        <text x={width - padRight} y={padTop + plotHeight - 2} textAnchor="end" className="cexr-axis-label">{compactNumber(yMin)}</text>
      </svg>
      {series.length < 2 && <div className="cexr-empty">库存历史从推进回合后开始记录</div>}
    </div>
  );
}
