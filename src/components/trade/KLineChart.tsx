/**
 * K线图面板（Stage 3 · 第三批次 · K线区抽离）
 *
 * 从 App.tsx 的 renderCandles useCallback 逐字搬运：K 线画布、成交量、热度条、
 * 指标与委托/持仓/历史叠加、价格刻度、点击提示等。
 * 用 memoIgnoringCallbacks 隔离：数据 props 不变时跳过渲染，
 * App 因弹窗/toast/快进标志等重渲染时不再连带重绘 K 线 DOM。
 */
import { useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Candle, FuturesPosition, Order, OrderHistory, Position, Token } from '../../types';
import { formatNumber, formatPrice } from '../../utils/format';
import { getGameCanvasSize, getHeatLevel, getTokenSentiment } from '../../data/heat';
import { memoIgnoringCallbacks } from '../../lib/memo';
import { useRenderProbe } from '../../lib/renderProbe';

export interface KLineViewSettings {
  showOrders: boolean;
  showHistory: boolean;
  showPosition: boolean;
  logScale: boolean;
  inverted: boolean;
  percentScale: boolean;
}

export interface KLineChartProps {
  isFullscreen: boolean;
  displayCandles: Candle[];
  klineOffset: number;
  klineScale: number;
  klinePeriod: '1h' | '4h' | '1d';
  currentToken: Token | null;
  currentTokenChange24h: number;
  tokenHeatMap: Record<string, { heat: number; duration: number; cap?: number; fullStreak?: number; zeroStreak?: number }>;
  isDarkMode: boolean;
  klineSelectedCandle: number | null;
  klineTapPos: { x: number; y: number } | null;
  candles: Candle[];
  currentRound: number;
  klineViewSettings: KLineViewSettings;
  orders: Order[];
  orderHistory: OrderHistory[];
  futuresPositions: FuturesPosition[];
  positions: Position[];
  setKlineSelectedCandle: Dispatch<SetStateAction<number | null>>;
  setKlineTapPos: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  klineMovedRef: MutableRefObject<boolean>;
}

function KLineChartInner({
  isFullscreen,
  displayCandles,
  klineOffset,
  klineScale,
  klinePeriod,
  currentToken,
  currentTokenChange24h,
  tokenHeatMap,
  isDarkMode,
  klineSelectedCandle,
  klineTapPos,
  candles,
  currentRound,
  klineViewSettings,
  orders,
  orderHistory,
  futuresPositions,
  positions,
  setKlineSelectedCandle,
  setKlineTapPos,
  klineMovedRef,
}: KLineChartProps) {
  useRenderProbe('KLineChart');
  // 缓存K线计算结果，避免重复计算（从 App 迁入）
  const klineCalcCache = useRef<{
    candlesLength: number;
    klineOffset: number;
    klineScale: number;
    klinePeriod: '1h' | '4h' | '1d';
    startIndex: number;
    result: {
      minPrice: number;
      maxPrice: number;
      highestIndex: number;
      lowestIndex: number;
      highestPrice: number;
      lowestPrice: number;
    } | null;
  }>({ candlesLength: 0, klineOffset: 0, klineScale: 1, klinePeriod: '1h', startIndex: -1, result: null });
    // 使用聚合后的K线数据
    const sourceCandles = displayCandles;
    if (sourceCandles.length === 0) return null;

    // 根据缩放比例计算可见K线数量
    const baseVisibleCount = isFullscreen ? 30 : 20;
    const visibleCount = Math.max(5, Math.floor(baseVisibleCount / klineScale));
    // 计算实际需要渲染的K线数量（包含右侧空白区域）
    const actualCandleCount = Math.min(visibleCount, sourceCandles.length + Math.max(0, -klineOffset));
    // 当klineOffset为负时，右侧会有空白区域
    const emptySlots = klineOffset < 0 ? Math.min(-klineOffset, visibleCount) : 0;
    // 获取实际K线数据
    const startIndex = Math.max(0, sourceCandles.length - (visibleCount - emptySlots) - Math.max(0, klineOffset));
    const visibleCandles = sourceCandles.slice(startIndex, startIndex + (visibleCount - emptySlots));
    if (visibleCandles.length === 0 && emptySlots === 0) return null;

    // 使用缓存优化价格计算 - 修复缓存比较逻辑
    let minPrice: number, maxPrice: number, highestIndex: number, lowestIndex: number, highestPrice: number, lowestPrice: number;
    
    const canUseCache = klineCalcCache.current.result && 
        klineCalcCache.current.candlesLength === sourceCandles.length && 
        klineCalcCache.current.klineOffset === klineOffset &&
        klineCalcCache.current.klineScale === klineScale &&
        klineCalcCache.current.klinePeriod === klinePeriod &&
        klineCalcCache.current.startIndex === startIndex;
    
    if (canUseCache && klineCalcCache.current.result) {
      const cached = klineCalcCache.current.result;
      minPrice = cached.minPrice;
      maxPrice = cached.maxPrice;
      highestIndex = cached.highestIndex;
      lowestIndex = cached.lowestIndex;
      highestPrice = cached.highestPrice;
      lowestPrice = cached.lowestPrice;
    } else {
      // 收集所有价格用于计算范围（仅使用实际K线数据）
      const allPrices = visibleCandles.length > 0 ? visibleCandles.flatMap(c => [c.high, c.low, c.open, c.close]) : [1];
      minPrice = Math.min(...allPrices);
      maxPrice = Math.max(...allPrices);

      // 找到最高价和最低价的K线索引（相对于实际K线数组）
      highestIndex = 0;
      lowestIndex = 0;
      highestPrice = visibleCandles.length > 0 ? visibleCandles[0].high : 0;
      lowestPrice = visibleCandles.length > 0 ? visibleCandles[0].low : 0;
      for (let i = 0; i < visibleCandles.length; i++) {
        const candle = visibleCandles[i];
        if (candle.high > highestPrice) {
          highestPrice = candle.high;
          highestIndex = i;
        }
        if (candle.low < lowestPrice) {
          lowestPrice = candle.low;
          lowestIndex = i;
        }
      }
      klineCalcCache.current = {
        candlesLength: sourceCandles.length,
        klineOffset,
        klineScale,
        klinePeriod,
        startIndex,
        result: { minPrice, maxPrice, highestIndex, lowestIndex, highestPrice, lowestPrice }
      };
    }

    // 确保价格范围有效 - 增强安全检查
    const safeMinPrice = minPrice > 0 ? minPrice : 0.000001;
    const safeMaxPrice = maxPrice > safeMinPrice ? maxPrice : safeMinPrice * 1.01;
    const priceRange = safeMaxPrice - safeMinPrice;
    const safeRange = priceRange > 0.0000001 ? priceRange : safeMaxPrice * 0.1;
    const padding = safeRange * 0.15;
    const adjustedMin = Math.max(0, safeMinPrice - padding);
    const adjustedMax = safeMaxPrice + padding;
    const adjustedRange = adjustedMax - adjustedMin;

    // 容器尺寸 - 基于20:9画布动态计算（已移除顶部安全区）
    const canvasSize = getGameCanvasSize();
    const canvasW = canvasSize.width;
    const canvasH = canvasSize.height;
    const safeAreaTop = 0; // 已移除顶部安全区
    const periodNavHeight = isFullscreen ? 32 : 0; // 周期导航栏高度
    const tradeBtnHeight = 50; // 底部交易按钮高度（12px margin-top + 14px padding + 12px margin-bottom + 边框）
    const containerHeight = isFullscreen ? (canvasH - safeAreaTop - 146 - tradeBtnHeight - periodNavHeight) : Math.min(320, Math.max(220, canvasH * 0.45)); // 全屏/普通视图均适配画布
    const priceScaleWidth = 50; // 右侧价格刻度宽度（缩小以扩大图表区域）
    const containerWidth = isFullscreen ? (canvasW - 32) : (canvasW - 20);
    // K线图高度占50%，成交量图高度占15%，热度情绪区域占20%
    const klineHeight = containerHeight * 0.50;
    const volumeHeight = containerHeight * 0.15;
    const heatHeight = containerHeight * 0.20;
    const chartWidth = containerWidth - priceScaleWidth - 10; // 减去刻度宽度

    // 视图设置：对数 / 倒垂 / 百分比
    const viewSettings = klineViewSettings;
    const logScale = viewSettings.logScale;
    const inverted = viewSettings.inverted;
    const percentScale = viewSettings.percentScale;
    // 【修复】对数视图最低坐标：取图上最低价再低一点点（避免 padding 把下限拉到 0 导致全部 K 线挤在顶部）
    const logSafeMin = Math.max(1e-9, safeMinPrice > 0 ? safeMinPrice * 0.95 : adjustedMin);
    const logMin = Math.max(1e-9, logSafeMin);
    const logMax = Math.max(logMin * 1.0001, adjustedMax);
    const logRange = Math.log(logMax) - Math.log(logMin);

    // 获取当前代币的热度数据（使用缓存值）
    const tokenHeat = currentToken ? (tokenHeatMap[currentToken.id] || { heat: 0, duration: 0, cap: 100 }) : { heat: 0, duration: 0, cap: 100 };
    // 使用组件外定义的常量和函数
    const heatLevel = getHeatLevel(tokenHeat.heat);

    // 获取当前代币的情绪（使用缓存的24h涨跌幅）
    const tokenSentiment = getTokenSentiment(currentTokenChange24h);
    // 使用预先计算的24h涨跌幅
    const change24h = currentTokenChange24h;
    
    // K线宽度和间距 - 根据缩放比例自适应，确保填满整个图表区域
    const gap = 2;
    // 计算K线宽度，确保总宽度正好填满图表区域
    // 总宽度 = visibleCount * candleWidth + (visibleCount - 1) * gap
    // chartWidth = visibleCount * candleWidth + (visibleCount - 1) * gap
    // candleWidth = (chartWidth - (visibleCount - 1) * gap) / visibleCount
    const candleWidth = Math.max(3, (chartWidth - (visibleCount - 1) * gap) / visibleCount);
    
    // Y坐标到价格的逆映射（对数/倒垂视图保持一致）
    const yToPrice = (y: number) => {
      const clampedY = Math.max(0, Math.min(klineHeight, y));
      let ratio = klineHeight > 0 ? (klineHeight - clampedY) / klineHeight : 0;
      if (inverted) ratio = 1 - ratio;
      if (logScale) {
        const logPrice = Math.log(logMin) + ratio * logRange;
        return Math.exp(logPrice);
      }
      return adjustedMin + ratio * adjustedRange;
    };

    // 计算价格到Y坐标的映射（仅用于K线图）
    const priceToY = (price: number) => {
      const boundedPrice = Math.max(adjustedMin, Math.min(adjustedMax, price));
      let ratio = logScale
        ? (Math.log(Math.max(logMin, boundedPrice)) - Math.log(logMin)) / (logRange || 1)
        : (boundedPrice - adjustedMin) / adjustedRange;
      ratio = Math.max(0, Math.min(1, ratio));
      if (inverted) ratio = 1 - ratio;
      return klineHeight - ratio * klineHeight;
    };

    // 百分比视图：价格轴以首个可见K线收盘价为基准显示涨跌幅
    const percentBasePrice = visibleCandles.length > 0 ? visibleCandles[0].close : (currentToken?.currentPrice || 1);
    const scaleLabel = (value: number) => {
      if (!percentScale) return formatPrice(value);
      const percent = ((value / Math.max(1e-9, percentBasePrice)) - 1) * 100;
      return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
    };
    
    // 计算成交量范围
    const allVolumes = visibleCandles.length > 0 ? visibleCandles.map(c => c.volume) : [0];
    const maxVolume = Math.max(...allVolumes, 1); // 避免除零
    
    // 成交量到Y坐标的映射（用于成交量图）
    const volumeToY = (volume: number) => {
      return volumeHeight - (volume / maxVolume) * volumeHeight;
    };
    
    // 最高价和最低价的Y坐标
    const highestY = priceToY(highestPrice);
    const lowestY = priceToY(lowestPrice);
    
    // ========== 网格线与点击交互 ==========
    // 网格线颜色：日间灰色 / 夜间白色（极细）
    const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.12)' : 'rgba(26, 26, 26, 0.10)';
    // 十字虚线颜色
    const crossColor = isDarkMode ? 'rgba(255, 255, 255, 0.55)' : 'rgba(26, 26, 26, 0.5)';
    
    // 点击/触摸K线区域：选中对应K线并记录点击位置
    const handleKlineAreaTap = (x: number, y: number) => {
      if (visibleCandles.length === 0) return;
      const clampedY = Math.max(0, Math.min(klineHeight, y));
      const index = Math.round((x - 5 - candleWidth / 2) / (candleWidth + gap));
      const clampedIndex = Math.max(0, Math.min(visibleCandles.length - 1, index));
      setKlineSelectedCandle(clampedIndex);
      setKlineTapPos({ x, y: clampedY });
    };
    
    // 选中的K线及其位置
    const selectedCandle = klineSelectedCandle !== null && klineSelectedCandle < visibleCandles.length
      ? visibleCandles[klineSelectedCandle]
      : null;
    const selectedX = klineSelectedCandle !== null ? klineSelectedCandle * (candleWidth + gap) + 5 + candleWidth / 2 : 0;
    
    // 选中K线的时间标签（第x天 xx:xx），按游戏回合推算
    const periodCountForTime = klinePeriod === '1h' ? 1 : klinePeriod === '4h' ? 4 : 24;
    const selectedTimeLabel = (() => {
      if (klineSelectedCandle === null || !selectedCandle) return '';
      const sourceIndex = (startIndex + klineSelectedCandle) * periodCountForTime;
      const round = currentRound - (candles.length - 1 - sourceIndex);
      const day = Math.max(1, Math.floor(round / 24) + 1);
      const hour = ((round % 24) + 24) % 24;
      return `第${day}天 ${hour.toString().padStart(2, '0')}:00`;
    })();
    
    // 点击位置对应的价格（用于右侧刻度标签）
    const selectedPriceAtY = klineTapPos
      ? yToPrice(klineTapPos.y)
      : 0;
    
    // 悬浮窗位置（避免超出图表区域）
    const tooltipWidth = 158;
    const tooltipHeight = 158;
    const tooltipLeft = klineTapPos
      ? (klineTapPos.x + 14 + tooltipWidth > containerWidth
          ? Math.max(2, klineTapPos.x - tooltipWidth - 14)
          : klineTapPos.x + 14)
      : 0;
    const tooltipTop = klineTapPos
      ? (klineTapPos.y + 12 + tooltipHeight > klineHeight
          ? Math.max(0, klineTapPos.y - tooltipHeight - 12)
          : klineTapPos.y + 12)
      : 0;
    
    return (
      <div className="kline-container" style={{ height: containerHeight, position: 'relative', width: '100%' }}>
        {/* K线区域 */}
        <div 
          className="kline-area" 
          data-testid="kline-chart-area"
          style={{ 
            position: 'relative',
            height: klineHeight, 
            width: chartWidth,
            overflow: 'hidden'
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            handleKlineAreaTap(e.clientX - rect.left, e.clientY - rect.top);
          }}
          onTouchEnd={(e) => {
            if (e.changedTouches.length !== 1 || klineMovedRef.current) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const t = e.changedTouches[0];
            handleKlineAreaTap(t.clientX - rect.left, t.clientY - rect.top);
          }}
        >
          {/* 网格线层：与刻度对齐（横线对齐价格刻度，竖线对齐每根K线刻度），日间灰色/夜间白色 */}
          {Array.from({ length: 5 }, (_, gi) => (
            <div
              key={`grid-h-${gi}`}
              style={{
                position: 'absolute',
                left: 0,
                top: (klineHeight * gi) / 4,
                width: chartWidth,
                height: 1,
                backgroundColor: gridColor,
                pointerEvents: 'none',
              }}
            />
          ))}
          {/* 竖线：等分K线区域，每段固定5根K线；随缩放同步移动，可见K线增多时线数相应增加，保证每段K线数量始终一致 */}
          {Array.from({ length: Math.floor(visibleCount / 5) }, (_, vi) => {
            const lineIndex = (vi + 1) * 5;
            if (lineIndex >= visibleCount) return null;
            return (
              <div
                key={`grid-v-${lineIndex}`}
                style={{
                  position: 'absolute',
                  left: lineIndex * (candleWidth + gap) + 5,
                  top: 0,
                  width: 1,
                  height: klineHeight,
                  backgroundColor: gridColor,
                  pointerEvents: 'none',
                }}
              />
            );
          })}
          {/* 渲染实际K线 */}
          {visibleCandles.map((candle, i) => {
            const isUp = candle.close >= candle.open;
            const color = isUp ? 'var(--up-color)' : 'var(--down-color)';
            
            const openY = priceToY(candle.open);
            const closeY = priceToY(candle.close);
            const highY = priceToY(candle.high);
            const lowY = priceToY(candle.low);
            
            const bodyTop = Math.min(openY, closeY);
            const bodyBottom = Math.max(openY, closeY);
            const bodyHeight = Math.max(1, bodyBottom - bodyTop);
            
            const wickHeight = Math.max(1, lowY - highY);
            
            return (
              <div
                key={`candle-${i}`}
                className="kline-candle"
                style={{
                  position: 'absolute',
                  left: i * (candleWidth + gap) + 5,
                  width: candleWidth,
                  top: 0,
                  height: klineHeight,
                }}
              >
                <div
                  className="kline-wick"
                  style={{
                    position: 'absolute',
                    left: candleWidth / 2 - 0.5,
                    top: highY,
                    height: wickHeight,
                    width: 1,
                    backgroundColor: color,
                  }}
                />
                <div
                  className="kline-body"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: bodyTop,
                    height: bodyHeight,
                    width: '100%',
                    backgroundColor: color,
                    borderRadius: 1,
                  }}
                />
              </div>
            );
          })}
          
          {/* 最高价标记（仅在有实际K线时显示） */}
          {visibleCandles.length > 0 && (
            <div
              className="kline-high-marker"
              style={{
                position: 'absolute',
                left: highestIndex * (candleWidth + gap) + 5 + candleWidth / 2,
                top: highestY - 2,
                transform: 'translateX(-50%)',
                zIndex: 5,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: 'var(--down-color)',
                  border: '1px solid #fff',
                  boxShadow: '0 0 4px rgba(246, 70, 93, 0.5)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: -18,
                  transform: 'translateX(-50%)',
                  fontSize: '9px',
                  color: 'var(--down-color)',
                  backgroundColor: 'rgba(246, 70, 93, 0.2)',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  whiteSpace: 'nowrap',
                  fontWeight: 500,
                }}
              >
                ${formatPrice(highestPrice)}
              </div>
            </div>
          )}
          
          {/* 最低价标记（仅在有实际K线时显示） */}
          {visibleCandles.length > 0 && (
            <div
              className="kline-low-marker"
              style={{
                position: 'absolute',
                left: lowestIndex * (candleWidth + gap) + 5 + candleWidth / 2,
                top: lowestY - 6,
                transform: 'translateX(-50%)',
                zIndex: 5,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: 'var(--up-color)',
                  border: '1px solid #fff',
                  boxShadow: '0 0 4px rgba(14, 203, 129, 0.5)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 12,
                  transform: 'translateX(-50%)',
                  fontSize: '9px',
                  color: 'var(--up-color)',
                  backgroundColor: 'rgba(14, 203, 129, 0.2)',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  whiteSpace: 'nowrap',
                  fontWeight: 500,
                }}
              >
                ${formatPrice(lowestPrice)}
              </div>
            </div>
          )}
          
          {/* 点击十字线：横竖虚线对齐刻度，下方显示时间标签 */}
          {selectedCandle && klineTapPos && (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: selectedX,
                  top: 0,
                  width: 1,
                  height: klineHeight,
                  borderLeft: `1px dashed ${crossColor}`,
                  pointerEvents: 'none',
                  zIndex: 8,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: klineTapPos.y,
                  width: chartWidth,
                  height: 1,
                  borderTop: `1px dashed ${crossColor}`,
                  pointerEvents: 'none',
                  zIndex: 8,
                }}
              />
              {/* 时间标签（横轴刻度下方，格式：第x天 xx:xx） */}
              <div
                style={{
                  position: 'absolute',
                  left: Math.max(30, Math.min(chartWidth - 30, selectedX)),
                  bottom: 0,
                  transform: 'translateX(-50%)',
                  fontSize: '9px',
                  color: isDarkMode ? '#eaecef' : '#1a1a1a',
                  backgroundColor: isDarkMode ? 'rgba(30, 35, 41, 0.92)' : 'rgba(255, 255, 255, 0.92)',
                  border: `1px solid ${isDarkMode ? '#3e454f' : '#e5e7eb'}`,
                  padding: '1px 5px',
                  borderRadius: '3px',
                  whiteSpace: 'nowrap',
                  zIndex: 9,
                  pointerEvents: 'none',
                }}
              >
                {selectedTimeLabel}
              </div>
            </>
          )}
        </div>
        
        {/* K线信息悬浮窗（点击K线区域后显示） */}
        {selectedCandle && klineTapPos && (
          <div
            className="kline-tooltip"
            style={{
              position: 'absolute',
              left: tooltipLeft,
              top: tooltipTop,
              width: tooltipWidth,
              zIndex: 50,
              backgroundColor: isDarkMode ? 'rgba(30, 35, 41, 0.86)' : 'rgba(255, 255, 255, 0.88)',
              border: `1px solid ${isDarkMode ? '#3e454f' : '#e5e7eb'}`,
              borderRadius: 8,
              boxShadow: isDarkMode ? '0 4px 16px rgba(0, 0, 0, 0.45)' : '0 4px 16px rgba(26, 26, 26, 0.12)',
              padding: '7px 9px',
              fontSize: 10,
              color: 'var(--text-primary)',
              pointerEvents: 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: 'var(--text-secondary)' }}>时间</span>
              <span style={{ fontWeight: 600 }}>{selectedTimeLabel}</span>
            </div>
            {([
              ['开', formatPrice(selectedCandle.open)],
              ['高', formatPrice(selectedCandle.high)],
              ['收', formatPrice(selectedCandle.close)],
              ['低', formatPrice(selectedCandle.low)],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                <span style={{ fontWeight: 500 }}>{value}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: 'var(--text-secondary)' }}>涨跌</span>
              <span style={{ fontWeight: 600, color: selectedCandle.close >= selectedCandle.open ? 'var(--up-color)' : 'var(--down-color)' }}>
                {selectedCandle.close >= selectedCandle.open ? '+' : ''}{formatPrice(selectedCandle.close - selectedCandle.open)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: 'var(--text-secondary)' }}>涨跌幅</span>
              <span style={{ fontWeight: 600, color: selectedCandle.close >= selectedCandle.open ? 'var(--up-color)' : 'var(--down-color)' }}>
                {selectedCandle.close >= selectedCandle.open ? '+' : ''}{(((selectedCandle.close - selectedCandle.open) / selectedCandle.open) * 100).toFixed(2)}%
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: 'var(--text-secondary)' }}>振幅</span>
              <span style={{ fontWeight: 500 }}>{(((selectedCandle.high - selectedCandle.low) / selectedCandle.open) * 100).toFixed(2)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>额</span>
              <span style={{ fontWeight: 600 }}>${formatNumber(selectedCandle.turnover ?? selectedCandle.volume * ((selectedCandle.high + selectedCandle.low + selectedCandle.close) / 3), 2)}</span>
            </div>
          </div>
        )}
        
        {/* 成交量区域 */}
        <div 
          className="volume-area" 
          style={{ 
            position: 'absolute',
            top: klineHeight + 10, // K线图下方，留10px间距
            left: 0,
            height: volumeHeight, 
            width: chartWidth,
            overflow: 'hidden'
          }}
        >
          {/* 渲染成交量柱 */}
          {visibleCandles.map((candle, i) => {
            const isUp = candle.close >= candle.open;
            const color = isUp ? 'rgba(14, 203, 129, 0.6)' : 'rgba(246, 70, 93, 0.6)';
            const volumeHeightPx = volumeHeight - volumeToY(candle.volume);
            
            return (
              <div
                key={`volume-${i}`}
                className="volume-bar"
                style={{
                  position: 'absolute',
                  left: i * (candleWidth + gap) + 5,
                  width: candleWidth,
                  bottom: 0,
                  height: candle.volume > 0 ? Math.max(3, volumeHeightPx) : 1,
                  backgroundColor: color,
                  borderRadius: '1px 1px 0 0',
                }}
              />
            );
          })}

        
        </div>
        {/* 右侧价格刻度 */}
        <div 
          className="kline-price-scale" 
          style={{ 
            position: 'absolute', 
            right: 0, 
            top: 0, 
            height: klineHeight,
            width: priceScaleWidth,
            display: 'flex', 
            flexDirection: 'column', 
            justifyContent: 'space-between',
            fontSize: '9px',
            color: isDarkMode ? '#848e9c' : '#4c5766',
            paddingLeft: '4px',
            zIndex: 10,
            backgroundColor: 'var(--bg-primary)',
          }}
        >
          <span>{scaleLabel(yToPrice(0))}</span>
          <span>{scaleLabel(yToPrice(klineHeight / 2))}</span>
          <span>{scaleLabel(yToPrice(klineHeight))}</span>
          {/* 点击位置对应的价格标签 */}
          {selectedCandle && klineTapPos && (
            <div
              style={{
                position: 'absolute',
                right: 2,
                top: klineTapPos.y,
                transform: 'translateY(-50%)',
                fontSize: '9px',
                fontWeight: 600,
                color: isDarkMode ? '#eaecef' : '#1a1a1a',
                backgroundColor: isDarkMode ? 'rgba(30, 35, 41, 0.92)' : 'rgba(255, 255, 255, 0.92)',
                border: `1px solid ${isDarkMode ? '#3e454f' : '#e5e7eb'}`,
                padding: '1px 4px',
                borderRadius: '3px',
                whiteSpace: 'nowrap',
                zIndex: 11,
                pointerEvents: 'none',
              }}
            >
              {formatPrice(selectedPriceAtY)}
            </div>
          )}
        </div>
        
        {/* 右侧成交量刻度 */}
        <div 
          className="volume-scale" 
          style={{ 
            position: 'absolute', 
            right: 0, 
            top: klineHeight + 10, 
            height: volumeHeight,
            width: priceScaleWidth,
            display: 'flex', 
            flexDirection: 'column', 
            justifyContent: 'space-between',
            fontSize: '8px',
            color: isDarkMode ? '#848e9c' : '#4c5766',
            paddingLeft: '4px',
            zIndex: 10,
            backgroundColor: 'var(--bg-primary)',
          }}
        >
          <span>{formatNumber(maxVolume)}</span>
          <span>{formatNumber(maxVolume / 2)}</span>
          <span>0</span>
        </div>
        
        {/* 缩放比例指示器 */}
        <div
          style={{
            position: 'absolute',
            left: 8,
            top: 4,
            fontSize: '10px',
            color: klineScale !== 1 ? '#f0b90b' : (isDarkMode ? '#848e9c' : '#4c5766'),
            backgroundColor: isDarkMode ? 'rgba(11, 14, 17, 0.8)' : 'rgba(236, 239, 243, 0.9)',
            padding: '2px 6px',
            borderRadius: '3px',
            zIndex: 10,
          }}
        >
          {klineScale.toFixed(1)}x
        </div>
          {/* 当前委托价格线 */}
          {viewSettings.showOrders && currentToken && orders.filter(order => order.tokenId === currentToken.id).slice(0, 10).map(order => {
            const orderY = priceToY(order.price);
            return (
              <div key={`open-order-line-${order.id}`} style={{ position: 'absolute', left: 0, right: 0, top: orderY, borderTop: '1px dashed rgba(59,130,246,0.65)', zIndex: 6, pointerEvents: 'none' }}>
                <span style={{ position: 'absolute', left: 2, top: -9, background: order.side === 'buy' ? 'rgba(14,203,129,0.92)' : 'rgba(246,70,93,0.92)', color: '#ffffff', fontSize: 8, fontWeight: 700, borderRadius: 3, padding: '1px 4px', whiteSpace: 'nowrap' }}>
                  {order.side === 'buy' ? 'B' : 'S'} {formatPrice(order.price)}
                </span>
              </div>
            );
          })}

          {/* 订单历史 B/S 标记 */}
          {viewSettings.showHistory && currentToken && orderHistory.filter(historyItem => historyItem.tokenId === currentToken.id).slice(0, 16).map((historyItem, markerIndex) => {
            const markerPrice = historyItem.avgPrice || historyItem.price || 0;
            if (!markerPrice || markerPrice <= 0) return null;
            const markerY = priceToY(markerPrice);
            const markerX = Math.min(chartWidth - 10, 10 + markerIndex * ((chartWidth - 20) / 16));
            return (
              <div
                key={`history-marker-${historyItem.id}-${markerIndex}`}
                className={`kline-order-marker ${historyItem.side}`}
                style={{ position: 'absolute', left: markerX, top: Math.max(2, Math.min(klineHeight - 20, markerY - 10)), zIndex: 7, pointerEvents: 'none' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', backgroundColor: historyItem.side === 'buy' ? 'rgba(14,203,129,0.92)' : 'rgba(246,70,93,0.92)', color: '#ffffff', fontSize: 9, fontWeight: 700, border: '1px solid rgba(255,255,255,0.7)' }}>
                  {historyItem.side === 'buy' ? 'B' : 'S'}
                </span>
              </div>
            );
          })}

          {/* 当前仓位虚线 + 开仓价格 */}
          {viewSettings.showPosition && currentToken && (() => {
            const futuresPosition = futuresPositions.find(position => position.tokenId === currentToken.id);
            const spotPosition = positions.find(position => position.tokenId === currentToken.id);
            const entryPrice = futuresPosition ? futuresPosition.entryPrice : (spotPosition?.avgCost || 0);
            if (!entryPrice || entryPrice <= 0) return null;
            const positionY = priceToY(entryPrice);
            const positionPnl = futuresPosition ? (futuresPosition.unrealizedPnl || 0) : ((spotPosition?.pnl as number) || 0);
            return (
              <div style={{ position: 'absolute', left: 0, right: 0, top: positionY, borderTop: '1px dashed rgba(240,185,11,0.9)', zIndex: 6, pointerEvents: 'none' }}>
                <span style={{ position: 'absolute', left: 2, top: -17, backgroundColor: positionPnl >= 0 ? 'rgba(240,185,11,0.95)' : 'rgba(246,70,93,0.95)', color: positionPnl >= 0 ? '#1e2329' : '#ffffff', fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>
                  {futuresPosition ? `P&L ${positionPnl >= 0 ? '+' : ''}${formatNumber(positionPnl, 2)}` : `持仓成本 ${formatPrice(entryPrice)}`}
                </span>
                <span style={{ position: 'absolute', right: 2, top: -9, backgroundColor: 'rgba(240,185,11,0.95)', color: '#1e2329', fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '0 4px' }}>
                  {formatPrice(entryPrice)}
                </span>
              </div>
            );
          })()}
          
      </div>
    );
}

export const KLineChart = memoIgnoringCallbacks(KLineChartInner);
