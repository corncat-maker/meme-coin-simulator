export type BottomNavTab = 'home' | 'market' | 'trade' | 'futures' | 'assets';

interface BottomNavProps {
  activeTab: BottomNavTab;
  onChange: (tab: BottomNavTab) => void;
  hidden: boolean;
}

export function BottomNav({ activeTab, onChange, hidden }: BottomNavProps) {
  if (hidden) return null;

  return (
    <div className="bottom-nav">
      <button
        className={`nav-tab ${activeTab === 'home' ? 'active' : ''}`}
        onClick={() => onChange('home')}
        data-testid="nav-home"
      >
        <span className="nav-icon">🏠</span>
        <span className="nav-label">首页</span>
      </button>
      <button
        className={`nav-tab ${activeTab === 'market' ? 'active' : ''}`}
        onClick={() => onChange('market')}
        data-testid="nav-market"
      >
        <span className="nav-icon">📈</span>
        <span className="nav-label">行情</span>
      </button>
      <button
        className={`nav-tab ${activeTab === 'trade' ? 'active' : ''}`}
        onClick={() => onChange('trade')}
        data-testid="nav-trade"
      >
        <span className="nav-icon">💱</span>
        <span className="nav-label">交易</span>
      </button>
      <button
        className={`nav-tab ${activeTab === 'futures' ? 'active' : ''}`}
        onClick={() => onChange('futures')}
        data-testid="nav-futures"
      >
        <span className="nav-icon">📊</span>
        <span className="nav-label">合约</span>
      </button>
      <button
        className={`nav-tab ${activeTab === 'assets' ? 'active' : ''}`}
        onClick={() => onChange('assets')}
        data-testid="nav-assets"
      >
        <span className="nav-icon">💰</span>
        <span className="nav-label">资产</span>
      </button>
    </div>
  );
}
