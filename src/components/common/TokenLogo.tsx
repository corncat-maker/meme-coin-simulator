import { getTokenLogo } from '../../data/tokenLogos';

interface TokenLogoProps {
  code: string;
  tierColor?: string;
  className?: string;
  size?: number;
}

/**
 * 代币 logo：优先使用内嵌的官方 logo（data URI），
 * 无官方图标的代币（如玩家自发行代币）回退为首字母圆形标识。
 * 内嵌 data URI 保证单文件 HTML 离线可用。
 */
export function TokenLogo({ code, tierColor = '#8b949e', className = 'market-coin-avatar', size }: TokenLogoProps) {
  const logo = getTokenLogo(code);
  const style: React.CSSProperties = size
    ? { ['--token-logo-size' as any]: `${size}px`, backgroundColor: tierColor }
    : { backgroundColor: tierColor };
  return (
    <span className={`token-logo ${className}${logo ? ' has-img' : ''}`} style={style}>
      {logo ? (
        <img className="token-logo-img" src={logo} alt={code} draggable={false} />
      ) : (
        <span className="token-logo-letter">{code.slice(0, 1)}</span>
      )}
    </span>
  );
}
