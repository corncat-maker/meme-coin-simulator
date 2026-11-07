/**
 * DEV 状态更新探针（Stage 3 · 第三批次 · 性能诊断）
 *
 * 包装 App 内的 useState：统计每个 setter 的调用次数，用于定位「每回合多余渲染」
 * 的元凶。生产构建下 useTrackedState 直接退化为 useState（无额外开销）。
 */
import { useCallback, useState } from 'react';

export const trackedStateCounts: Record<string, number> = {};

const isDev = import.meta.env.DEV;

export function useTrackedState<T>(
  name: string,
  initial: T | (() => T),
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial as T);
  const set = useCallback((next: T | ((prev: T) => T)) => {
    trackedStateCounts[name] = (trackedStateCounts[name] || 0) + 1;
    setValue(next as T);
  }, [name]);
  return [value, isDev ? set : setValue];
}

export function resetTrackedStateCounts(): void {
  for (const k of Object.keys(trackedStateCounts)) delete trackedStateCounts[k];
}
