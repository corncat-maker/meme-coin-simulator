/**
 * 渲染隔离工具：忽略「每次渲染都会新建」的回调引用，只比较真实数据 props。
 *
 * 使用场景：父组件用内联箭头函数传 onSelectToken / onClosePosition 等回调时，
 * React.memo 默认浅比较会因函数引用变化而失效。这里对函数 props 一律视为相等，
 * 其余 props 走 Object.is —— 回调捕获的依赖若变化，通常伴随对应数据 props 变化，
 * 因此不会出现行为滞后。
 */
import { memo, type ComponentType } from 'react';

export function memoIgnoringCallbacks<P extends object>(Component: ComponentType<P>) {
  const Wrapped = memo(Component, (prev: P, next: P) => {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const key of keys) {
      const a = (prev as Record<string, unknown>)[key];
      const b = (next as Record<string, unknown>)[key];
      if (typeof a === 'function' && typeof b === 'function') continue;
      if (!Object.is(a, b)) return false;
    }
    return true;
  });
  return Wrapped;
}
