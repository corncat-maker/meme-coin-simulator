interface FearGreedGaugeProps {
  fearGreedIndex: number;
  isDarkMode: boolean;
}

export function FearGreedGauge({ fearGreedIndex, isDarkMode }: FearGreedGaugeProps) {
  return (
    <div className="fear-greed-gauge-card">
      <div className="gauge-title">恐惧贪婪指数</div>
      <div className="gauge-container">
        <svg className="gauge-svg" viewBox="0 0 200 120">
          {/* 定义渐变 */}
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f6465d" />
              <stop offset="50%" stopColor={isDarkMode ? '#ffffff' : '#c7cdd6'} />
              <stop offset="100%" stopColor="#0ecb81" />
            </linearGradient>
          </defs>
          {/* 背景圆弧 */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke={isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
            strokeWidth="12"
            strokeLinecap="round"
          />
          {/* 渐变圆弧 */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="12"
            strokeLinecap="round"
          />
          {/* 指针 */}
          {(() => {
            // 计算指针角度：0对应左侧(180度)，100对应右侧(0度)
            const angle = 180 - (fearGreedIndex / 100) * 180;
            const radian = (angle * Math.PI) / 180;
            const pointerLength = 60;
            const centerX = 100;
            const centerY = 100;
            const pointerX = centerX + Math.cos(radian) * pointerLength;
            const pointerY = centerY - Math.sin(radian) * pointerLength;
            // 指针颜色根据数值变化
            let pointerColor = isDarkMode ? '#ffffff' : '#3a4450';
            if (fearGreedIndex < 50) {
              pointerColor = 'var(--down-color)';
            } else if (fearGreedIndex > 50) {
              pointerColor = 'var(--up-color)';
            }
            return (
              <>
                {/* 指针线 */}
                <line
                  x1={centerX}
                  y1={centerY}
                  x2={pointerX}
                  y2={pointerY}
                  stroke={pointerColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                {/* 中心圆点 */}
                <circle
                  cx={centerX}
                  cy={centerY}
                  r="6"
                  fill={pointerColor}
                />
              </>
            );
          })()}
        </svg>
        {/* 数值显示 */}
        <div className={`gauge-value ${fearGreedIndex < 50 ? 'fear' : fearGreedIndex > 50 ? 'greed' : 'neutral'}`}>
          {fearGreedIndex}
        </div>
        {/* 情绪等级 */}
        <div className={`gauge-label ${fearGreedIndex < 50 ? 'fear' : fearGreedIndex > 50 ? 'greed' : 'neutral'}`}>
          {fearGreedIndex <= 20 ? '极度恐慌' :
           fearGreedIndex <= 40 ? '恐慌' :
           fearGreedIndex <= 60 ? '中性' :
           fearGreedIndex <= 80 ? '贪婪' : '极度贪婪'}
        </div>
      </div>
    </div>
  );
}
