// 从 src/App.tsx 机械搬迁（Stage 1），逻辑未改动。
import type { Token } from '../types';
import { useEffect, useMemo, useRef, useState } from 'react';

// ============ 开发者面板：支持搜索的代币选择器 ============
export const DevTokenPicker = ({
  value,
  onChange,
  tokens,
  testId,
  placeholder = '请选择代币',
}: {
  value: string;
  onChange: (id: string) => void;
  tokens: Token[];
  testId: string;
  placeholder?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const listedTokens = useMemo(() => tokens.filter(t => t.cexListed !== false), [tokens]);
  const selected = useMemo(() => listedTokens.find(t => t.id === value) || null, [listedTokens, value]);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 打开时聚焦搜索框，关闭时清空关键词
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setQuery('');
    }
  }, [open]);

  const keyword = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!keyword) return listedTokens;
    return listedTokens.filter(t =>
      t.code.toLowerCase().includes(keyword) ||
      t.name.toLowerCase().includes(keyword) ||
      t.id.toLowerCase().includes(keyword)
    );
  }, [listedTokens, keyword]);

  return (
    <div className="dev-token-picker" ref={rootRef}>
      <button
        type="button"
        className={`dev-token-picker-trigger ${selected ? 'has-value' : ''}`}
        onClick={() => setOpen(o => !o)}
        data-testid={testId}
      >
        {selected ? (
          <>
            <span className="dev-token-picker-code">{selected.code}</span>
            <span className="dev-token-picker-name">{selected.name}</span>
          </>
        ) : (
          <span className="dev-token-picker-placeholder">{placeholder}</span>
        )}
        <span className={`dev-token-picker-arrow ${open ? 'open' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="dev-token-picker-dropdown">
          <div className="dev-token-picker-search">
            <span className="dev-token-picker-search-icon">🔍</span>
            <input
              ref={searchRef}
              className="dev-token-picker-search-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索代币代码或名称"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              data-testid={`${testId}-search-input`}
            />
          </div>
          <div className="dev-token-picker-list">
            {filtered.length === 0 ? (
              <div className="dev-token-picker-empty">未找到匹配的代币</div>
            ) : (
              filtered.map(t => (
                <button
                  type="button"
                  key={t.id}
                  className={`dev-token-picker-item ${t.id === value ? 'selected' : ''}`}
                  onClick={() => {
                    onChange(t.id);
                    setOpen(false);
                  }}
                  data-testid={`${testId}-option-${t.id}`}
                >
                  <span className="dev-token-picker-item-code">{t.code}</span>
                  <span className="dev-token-picker-item-name">{t.name}</span>
                  {t.id === value && <span className="dev-token-picker-item-check">✓</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
