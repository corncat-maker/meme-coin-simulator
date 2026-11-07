/**
 * 可控随机源（Stage3 第二批：handleFastForward 纯函数化前置）
 *
 * 设计原则：
 * 1. 默认零行为变化——未注入时 `rnd()` 直接返回 `Math.random()`，调用序列与旧代码完全一致，
 *    因此回归快照必须 0 差异。
 * 2. 可注入——测试/回放时可 `setRandomSource(makeSeededRandom(seed))`，让整回合计算 100% 可复现。
 * 3. 无副作用、不读全局状态以外的东西；注入源可通过 `withSeededRandom` 作用域化后自动还原。
 */

let injectedSource: (() => number) | null = null;

/** 取一个 [0,1) 随机数：优先使用注入源，否则退化为原生 Math.random（默认路径）。 */
export function rnd(): number {
  return injectedSource ? injectedSource() : Math.random();
}

/** 设置全局随机源；传 null 恢复原生 Math.random。 */
export function setRandomSource(source: (() => number) | null): void {
  injectedSource = source;
}

/** 当前是否处于可控（注入）随机模式下。 */
export function hasInjectedRandom(): boolean {
  return injectedSource !== null;
}

/** mulberry32：小巧、快速、可复现的 32 位 PRNG。 */
export function makeSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 在指定种子作用域内执行，结束后自动还原原随机源（异常安全）。 */
export function withSeededRandom<T>(seed: number, fn: () => T): T {
  const previous = injectedSource;
  injectedSource = makeSeededRandom(seed);
  try {
    return fn();
  } finally {
    injectedSource = previous;
  }
}
