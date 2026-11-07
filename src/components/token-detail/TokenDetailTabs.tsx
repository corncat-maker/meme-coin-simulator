import { useMemo } from 'react';
import type { Candle, CommunityPost, Token } from '../../types';
import { compute24hTurnover } from '../../logic/volume';

const formatCompact = (value: number): string => {
  if (!Number.isFinite(value)) return '--';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(2);
};

const formatPriceValue = (value: number): string => {
  if (!Number.isFinite(value)) return '--';
  if (value >= 1000) return value.toFixed(2);
  if (value >= 1) return value.toFixed(3);
  if (value >= 0.01) return value.toFixed(5);
  return value.toFixed(6);
};

export interface TokenDetailInfoProps {
  token: Token;
  tokens: Token[];
  candles: Candle[];
  markPrice: number;
}

export function TokenDetailInfo({ token, tokens, candles, markPrice }: TokenDetailInfoProps) {
  const rank = useMemo(() => {
    const sorted = [...tokens].sort((a, b) => b.marketCap - a.marketCap);
    return sorted.findIndex(t => t.id === token.id) + 1;
  }, [tokens, token.id]);

  const last24 = candles.slice(-24);
  const high24 = last24.length > 0 ? Math.max(...last24.map(c => c.high)) : token.currentPrice;
  const low24 = last24.length > 0 ? Math.min(...last24.map(c => c.low)) : token.currentPrice;
  const turnover24 = compute24hTurnover(last24);
  const totalMarketCap = tokens.reduce((sum, t) => sum + t.marketCap, 0);
  const circulating = token.circulatingSupply;
  const totalSupply = token.totalSupply;
  const fdMarketCap = token.currentPrice * totalSupply;
  const marketShare = totalMarketCap > 0 ? (token.marketCap / totalMarketCap) * 100 : 0;
  const turnoverRatio = token.marketCap > 0 ? (turnover24 / token.marketCap) * 100 : 0;
  const athPrice = candles.length > 0 ? Math.max(...candles.map(c => c.high)) : token.athPrice;
  const atlPrice = candles.length > 0 ? Math.min(...candles.map(c => c.low)) : token.currentPrice;

  const rows: { label: string; value: string }[] = [
    { label: '市值', value: `$${formatCompact(token.marketCap)}` },
    { label: '市值排名', value: `第 ${rank} 名` },
    { label: '完全稀释市值', value: `$${formatCompact(fdMarketCap)}` },
    { label: '市场占有率', value: `${marketShare.toFixed(4)}%` },
    { label: '成交量(24h)', value: `$${formatCompact(turnover24)}` },
    { label: '成交量/市值', value: `${turnoverRatio.toFixed(2)}%` },
    { label: '流通数量', value: `${formatCompact(circulating)} ${token.code}` },
    { label: '最大供给量', value: `${formatCompact(totalSupply)} ${token.code}` },
    { label: '总量', value: `${formatCompact(totalSupply)} ${token.code}` },
    { label: '历史最高价', value: `$${formatPriceValue(athPrice)}` },
    { label: '历史最低价', value: `$${formatPriceValue(atlPrice)}` },
    { label: '标记价格', value: `$${formatPriceValue(markPrice)}` },
  ];

  return (
    <div className="td-info">
      <p className="td-info-disclaimer">
        * 基础数据由模拟游戏提供，仅供参考。此信息以“原样”呈现，不构成任何形式的陈述或保证。
      </p>
      <div className="td-info-title-row">
        <span className="td-info-token-name">{token.name}</span>
        <span className="td-info-token-code">{token.code}USDT · 永续</span>
      </div>
      <div className="td-info-grid">
        {rows.map(row => (
          <div className="td-info-item" key={row.label}>
            <span className="td-info-label">{row.label}</span>
            <span className="td-info-value">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface ContractPositionPoint {
  round: number;
  tokenId?: string;
  totalLongQuantity: number;
  totalShortQuantity: number;
  totalLongValue: number;
  totalShortValue: number;
}

export interface LongShortRatioPoint {
  round: number;
  tokenId?: string;
  longPercent?: number;
  shortPercent?: number;
  longValue?: number;
  shortValue?: number;
  ratio?: number;
}

export interface LongShortCountPoint {
  round: number;
  tokenId?: string;
  longCount: number;
  shortCount: number;
  ratio?: number;
}

export interface TokenDetailDataProps {
  tokenId: string;
  contractPositionHistory: ContractPositionPoint[];
  longShortRatioHistory: LongShortRatioPoint[];
  longShortCountHistory: LongShortCountPoint[];
}

const CHART_W = 560;
const CHART_H = 150;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;
const PAD_LEFT = 30;
const PAD_RIGHT = 12;

function roundLabel(round: number): string {
  const day = Math.floor(round / 24) + 1;
  const hour = round % 24;
  return `${String(hour).padStart(2, '0')}:00`;
}

export function TokenDetailData({ tokenId, contractPositionHistory, longShortRatioHistory, longShortCountHistory }: TokenDetailDataProps) {
  const positionPoints = useMemo(
    () => contractPositionHistory.filter(h => h.tokenId === tokenId).slice(-40),
    [contractPositionHistory, tokenId],
  );
  const ratioPoints = useMemo(
    () => longShortRatioHistory.filter(h => h.tokenId === tokenId).slice(-40),
    [longShortRatioHistory, tokenId],
  );
  const countPoints = useMemo(
    () => longShortCountHistory.filter(h => h.tokenId === tokenId).slice(-40),
    [longShortCountHistory, tokenId],
  );

  const plotWidth = CHART_W - PAD_LEFT - PAD_RIGHT;
  const plotHeight = CHART_H - PAD_TOP - PAD_BOTTOM;
  const stepX = (count: number) => (count > 1 ? plotWidth / count : plotWidth);

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(ratio => (
    <line
      key={ratio}
      x1={PAD_LEFT}
      x2={CHART_W - PAD_RIGHT}
      y1={PAD_TOP + plotHeight * (1 - ratio)}
      y2={PAD_TOP + plotHeight * (1 - ratio)}
      stroke="currentColor"
      strokeOpacity="0.12"
      strokeWidth="1"
    />
  ));

  const positionMaxQ = Math.max(1, ...positionPoints.map(p => p.totalLongQuantity + p.totalShortQuantity));
  const positionMaxV = Math.max(1, ...positionPoints.map(p => p.totalLongValue + p.totalShortValue));
  const positionStep = stepX(positionPoints.length);

  const ratioStep = stepX(ratioPoints.length);
  const countMax = Math.max(1, ...countPoints.map(p => p.longCount + p.shortCount));
  const countStep = stepX(countPoints.length);

  const empty = (text: string) => <div className="td-chart-empty">{text}</div>;

  return (
    <div className="td-data">
      <div className="td-chart-card">
        <div className="td-chart-header">
          <span className="td-chart-title">合约持仓量</span>
          <span className="td-chart-legend">
            <i className="td-dot amber" />持仓数量
            <i className="td-dot blue" />持仓价值
          </span>
        </div>
        {positionPoints.length === 0 ? empty('暂无历史数据') : (
          <svg className="td-chart-svg" viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none">
            {gridLines}
            {positionPoints.map((point, index) => {
              const totalQ = point.totalLongQuantity + point.totalShortQuantity;
              const barHeight = (totalQ / positionMaxQ) * plotHeight;
              const barWidth = Math.max(2, positionStep * 0.62);
              const x = PAD_LEFT + index * positionStep + (positionStep - barWidth) / 2;
              return (
                <rect
                  key={`bar-${point.round}`}
                  x={x}
                  y={PAD_TOP + plotHeight - barHeight}
                  width={barWidth}
                  height={Math.max(1, barHeight)}
                  rx="1.5"
                  fill="#f0b90b"
                  opacity="0.85"
                />
              );
            })}
            <polyline
              fill="none"
              stroke="#3b82f6"
              strokeWidth="1.6"
              points={positionPoints.map((point, index) => {
                const x = PAD_LEFT + index * positionStep + positionStep / 2;
                const y = PAD_TOP + plotHeight - ((point.totalLongValue + point.totalShortValue) / positionMaxV) * plotHeight;
                return `${x},${y}`;
              }).join(' ')}
            />
            {positionPoints.map((point, index) => {
              if (index % Math.max(1, Math.ceil(positionPoints.length / 4)) !== 0 && index !== positionPoints.length - 1) return null;
              return (
                <text key={`label-${point.round}`} x={PAD_LEFT + index * positionStep + positionStep / 2} y={CHART_H - 6} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.55">
                  {roundLabel(point.round)}
                </text>
              );
            })}
          </svg>
        )}
      </div>

      <div className="td-chart-card">
        <div className="td-chart-header">
          <span className="td-chart-title">多空比</span>
          <span className="td-chart-legend">
            <i className="td-dot green" />多头
            <i className="td-dot red" />空头
          </span>
        </div>
        {ratioPoints.length === 0 ? empty('暂无历史数据') : (
          <svg className="td-chart-svg" viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none">
            {gridLines}
            {ratioPoints.map((point, index) => {
              const longPercent = Number.isFinite(point.longPercent as number) ? (point.longPercent as number) : 50;
              const longH = (Math.max(0, Math.min(100, longPercent)) / 100) * plotHeight;
              const shortH = plotHeight - longH;
              const barWidth = Math.max(2, ratioStep * 0.62);
              const x = PAD_LEFT + index * ratioStep + (ratioStep - barWidth) / 2;
              return (
                <g key={`ratio-${point.round}`}>
                  <rect x={x} y={PAD_TOP + plotHeight - longH} width={barWidth} height={longH} fill="#0ecb81" opacity="0.9" />
                  <rect x={x} y={PAD_TOP} width={barWidth} height={Math.max(0, shortH)} fill="#f6465d" opacity="0.9" />
                </g>
              );
            })}
            {ratioPoints.map((point, index) => {
              if (index % Math.max(1, Math.ceil(ratioPoints.length / 4)) !== 0 && index !== ratioPoints.length - 1) return null;
              return (
                <text key={`ratio-label-${point.round}`} x={PAD_LEFT + index * ratioStep + ratioStep / 2} y={CHART_H - 6} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.55">
                  {roundLabel(point.round)}
                </text>
              );
            })}
          </svg>
        )}
      </div>

      <div className="td-chart-card">
        <div className="td-chart-header">
          <span className="td-chart-title">多空人数比</span>
          <span className="td-chart-legend">
            <i className="td-dot green" />多头人数
            <i className="td-dot red" />空头人数
          </span>
        </div>
        {countPoints.length === 0 ? empty('暂无历史数据') : (
          <svg className="td-chart-svg" viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none">
            {gridLines}
            {countPoints.map((point, index) => {
              const total = point.longCount + point.shortCount;
              const longH = total > 0 ? (point.longCount / countMax) * plotHeight : 0;
              const shortH = total > 0 ? (point.shortCount / countMax) * plotHeight : 0;
              const barWidth = Math.max(2, countStep * 0.62);
              const x = PAD_LEFT + index * countStep + (countStep - barWidth) / 2;
              return (
                <g key={`count-${point.round}`}>
                  <rect x={x} y={PAD_TOP + plotHeight - longH} width={barWidth} height={longH} fill="#0ecb81" opacity="0.9" />
                  <rect x={x} y={PAD_TOP + plotHeight - longH - shortH} width={barWidth} height={shortH} fill="#f6465d" opacity="0.9" />
                </g>
              );
            })}
            {countPoints.map((point, index) => {
              if (index % Math.max(1, Math.ceil(countPoints.length / 4)) !== 0 && index !== countPoints.length - 1) return null;
              return (
                <text key={`count-label-${point.round}`} x={PAD_LEFT + index * countStep + countStep / 2} y={CHART_H - 6} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.55">
                  {roundLabel(point.round)}
                </text>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

export interface TokenDetailCommunityProps {
  token: Token;
  posts: CommunityPost[];
  currentRound: number;
  onLikePost: (postId: string) => void;
  onRefresh: () => void;
}

export function TokenDetailCommunity({ token, posts, currentRound, onLikePost, onRefresh }: TokenDetailCommunityProps) {
  const filteredPosts = useMemo(
    () => posts.filter(post => post.tokenId === token.id).slice(0, 30),
    [posts, token.id],
  );

  return (
    <div className="td-community">
      <div className="td-community-head">
        <span className="td-community-title">${token.code} 社区</span>
        <button type="button" className="td-community-refresh" onClick={onRefresh}>刷新</button>
      </div>
      {filteredPosts.length === 0 ? (
        <div className="td-community-empty">
          <span className="td-community-empty-icon">💬</span>
          <span>该代币暂无帖子，快进游戏时间后再看看</span>
        </div>
      ) : (
        <div className="community-posts-list td-community-list">
          {filteredPosts.map(post => (
            <div key={post.id} className={`community-post-item ${post.authorType === 'top_trader' || post.authorType === 'whale' ? 'top-trader-post' : ''}`}>
              <div className="post-header">
                <div className="post-author-info">
                  <span className={`post-avatar ${post.authorType === 'whale' ? 'whale' : post.authorType === 'top_trader' ? 'trader' : 'retail'}`}>
                    {(post.authorName || '?').charAt(0)}
                  </span>
                  <div className="post-author-meta">
                    <span className={`post-author-name ${post.authorType === 'top_trader' || post.authorType === 'whale' ? 'top-trader' : 'retail'}`}>
                      {post.authorName}
                      {post.authorType === 'whale' && <span className="whale-badge">🐋 巨鲸</span>}
                      {post.authorType === 'top_trader' && <span className="top-trader-badge">顶级交易员</span>}
                    </span>
                    <div className="post-tags-row">
                      <span className={`post-token-tag sentiment-${post.sentiment}`}>${post.tokenCode}</span>
                      {post.emotion === 'happy' && <span className="emotion-tag happy">🎉</span>}
                      {post.emotion === 'angry' && <span className="emotion-tag angry">😤</span>}
                    </div>
                  </div>
                </div>
                <span className="post-time">{currentRound - post.timestamp === 0 ? '刚刚' : `${currentRound - post.timestamp}小时前`}</span>
              </div>
              <div className="post-content">{post.content}</div>
              <div className="post-actions">
                <button
                  type="button"
                  className={`post-action-btn like-btn ${post.isLiked ? 'liked' : ''}`}
                  onClick={() => onLikePost(post.id)}
                >
                  <span className="action-icon">{post.isLiked ? '❤️' : '🤍'}</span>
                  <span className="action-count">{post.likes}</span>
                </button>
                <button type="button" className="post-action-btn comment-btn">
                  <span className="action-icon">💬</span>
                  <span className="action-count">{post.comments}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
