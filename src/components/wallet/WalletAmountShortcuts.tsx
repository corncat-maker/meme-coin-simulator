interface WalletAmountShortcutsProps {
  prefix: string;
  percent: number;
  disabled?: boolean;
  onChange: (percent: number) => void;
}

/** 百分比仅填写表单，不触发任何交易。 */
export function WalletAmountShortcuts({ prefix, percent, disabled, onChange }: WalletAmountShortcutsProps) {
  return (
    <div className="wallet-amount-shortcuts">
      <div className="wallet-shortcut-head"><span>使用可用余额</span><strong>{Math.round(percent)}%</strong></div>
      <input
        type="range" min={0} max={100} step={1} value={percent} disabled={disabled}
        onChange={event => onChange(Number(event.target.value))}
        className="wallet-percent-range" aria-label="使用余额比例" data-testid={`${prefix}-slider`}
      />
      <div className="wallet-percent-presets">
        {[25, 50, 75, 100].map(value => (
          <button
            type="button" key={value} disabled={disabled}
            className={`wallet-percent-preset ${Math.abs(percent - value) < 0.01 ? 'selected' : ''}`}
            onClick={() => onChange(value)} data-testid={`${prefix}-preset-${value}`}
          >{value === 100 ? '最大' : `${value}%`}</button>
        ))}
      </div>
    </div>
  );
}