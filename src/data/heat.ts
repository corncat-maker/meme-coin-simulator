// 从 src/App.tsx 机械搬迁（Stage 1），逻辑未改动。
// ============ 常量定义（移到组件外部避免重复创建） ============
// 热度等级描述
export const HEAT_LEVELS = [
  { threshold: 80, label: '极热', color: '#ff4757' },
  { threshold: 60, label: '热门', color: '#ff6b81' },
  { threshold: 40, label: '活跃', color: '#ffa502' },
  { threshold: 20, label: '一般', color: '#7bed9f' },
] as const;

// 情绪等级描述（中间范围）
export const SENTIMENT_LEVELS = [
  { threshold: 25, label: '极度贪婪', color: '#ff4757', emoji: '🚀' },
  { threshold: 10, label: '贪婪', color: '#ff6b81', emoji: '😁' },
  { threshold: 5, label: '乐观', color: '#ffa502', emoji: '😊' },
  { threshold: -5, label: '中性', color: '#848e9c', emoji: '😐' },
  { threshold: -10, label: '担忧', color: '#5352ed', emoji: '😟' },
  { threshold: -25, label: '恐慌', color: '#3742fa', emoji: '😰' },
] as const;

// 获取热度等级
export const getHeatLevel = (heat: number) => {
  for (const level of HEAT_LEVELS) {
    if (heat >= level.threshold) return { label: level.label, color: level.color };
  }
  return { label: '冷门', color: '#848e9c' };
};

// 获取情绪等级（含极端情况反转）
// 反转机制提前：涨幅过高时恐慌（担心追高被套），跌幅过大时贪婪（抄底机会）
export const getTokenSentiment = (change: number) => {
  // 极端反转情况（优先判断）
  // 涨幅 ≥ 100%: 极度恐慌（市场过热，散户担心追高被套）
  if (change >= 100) {
    return { label: '极度恐慌', color: '#2f3542', emoji: '😱' };
  }
  // 涨幅 50%-100%: 恐慌（涨幅过高，风险加大）
  if (change >= 50) {
    return { label: '恐慌', color: '#3742fa', emoji: '😰' };
  }
  // 跌幅 ≤ -75%: 极度贪婪（抄底良机）
  if (change <= -75) {
    return { label: '极度贪婪', color: '#ff4757', emoji: '🚀' };
  }
  // 跌幅 -75% ~ -50%: 贪婪（抄底机会）
  if (change <= -50) {
    return { label: '贪婪', color: '#ff6b81', emoji: '😁' };
  }
  // 跌幅 < -25%: 极度恐慌（恐慌性抛售）
  if (change < -25) {
    return { label: '极度恐慌', color: '#2f3542', emoji: '😱' };
  }
  // 中间范围：按阈值判断
  for (const level of SENTIMENT_LEVELS) {
    if (change >= level.threshold) return { label: level.label, color: level.color, emoji: level.emoji };
  }
  // 默认返回（-10%以下但未到-25%）
  return { label: '恐慌', color: '#3742fa', emoji: '😰' };
};

// 计算20:9画面比例下的游戏画布尺寸（高:宽 = 20:9）
export const getGameCanvasSize = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const canvasWidth = Math.min(vw, (vh * 9) / 20);
  const canvasHeight = Math.min(vh, (vw * 20) / 9);
  return { width: Math.max(280, canvasWidth), height: Math.max(360, canvasHeight) };
};
