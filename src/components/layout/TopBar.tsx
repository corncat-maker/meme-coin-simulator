interface TopBarProps {
  timeText: string;
  isAutoFastForwarding: boolean;
  isFastForwarding: boolean;
  onFastForwardClick: () => void;
}

export function TopBar({
  timeText,
  isAutoFastForwarding,
  isFastForwarding,
  onFastForwardClick,
}: TopBarProps) {
  return (
    <div className="top-info-bar">
      <div className="top-info-left">
        <span className="round-time">{timeText}</span>
      </div>
      <div className="top-info-center">
        <span className="game-title">Meme币庄家模拟器</span>
      </div>
      <div className="top-info-right">
        <button
          className={`ff-btn ${isAutoFastForwarding ? 'ff-active' : ''}`}
          onClick={onFastForwardClick}
          disabled={isFastForwarding}
          data-testid="fast-forward-btn"
        >
          {isAutoFastForwarding ? '⏸' : '⏩'}
        </button>
      </div>
    </div>
  );
}
