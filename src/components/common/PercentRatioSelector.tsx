interface PercentRatioSelectorProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  containerClassName: string;
  testIdPrefix: string;
}

export function PercentRatioSelector({
  label,
  value,
  onChange,
  containerClassName,
  testIdPrefix,
}: PercentRatioSelectorProps) {
  return (
    <div className={containerClassName}>
      <label>{label}</label>
      <div className="ratio-buttons">
        {[25, 50, 75, 100].map(ratio => (
          <button
            key={ratio}
            className={`ratio-btn ${value === ratio ? 'active' : ''}`}
            onClick={() => onChange(ratio)}
            data-testid={`${testIdPrefix}-ratio-${ratio}`}
          >
            {ratio}%
          </button>
        ))}
      </div>
      <input
        type="range"
        min="1"
        max="100"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="ratio-slider"
        data-testid={`${testIdPrefix}-ratio-slider`}
      />
    </div>
  );
}
