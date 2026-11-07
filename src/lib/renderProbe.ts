// 【仅开发环境】渲染探针：统计各组件渲染次数，供性能对比脚本读取
// 生产构建不注入（import.meta.env.DEV 为 false 时直接返回），不改变任何渲染结果。
export function useRenderProbe(name: string): void {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __RENDER_PROBE__?: { counts: Record<string, number>; since: number } };
  if (!w.__RENDER_PROBE__) {
    w.__RENDER_PROBE__ = { counts: {}, since: Date.now() };
  }
  const probe = w.__RENDER_PROBE__;
  probe.counts[name] = (probe.counts[name] || 0) + 1;
}

/** 重置计数器（供对比脚本在开始测量前调用） */
export function resetRenderProbe(): void {
  const w = window as unknown as { __RENDER_PROBE__?: { counts: Record<string, number>; since: number } };
  if (!w.__RENDER_PROBE__) return;
  w.__RENDER_PROBE__.counts = {};
  w.__RENDER_PROBE__.since = Date.now();
}
