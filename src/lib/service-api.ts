/**
 * 本地服务 API 实现
 * 
 * 该模块已修改为本地实现，不再依赖 lingguang.service
 * 所有 API 调用将返回本地模拟数据
 */

type AnyFunction = (...args: any[]) => any;

// 本地模拟 API 响应
const createMockApi = () => {
  return {
    // 本地模拟方法 - 返回空数据或默认值
    // 如果游戏需要实际的后端服务，可以在这里实现本地逻辑
  } as Record<string, AnyFunction>;
};

export function createServiceApi() {
  // 返回本地模拟 API，不再依赖 lingguang.service
  console.log('[FLASH APP] 使用本地 API 实现，不依赖网络服务');
  return createMockApi();
}

// 导出类型供其他模块使用（如果需要）
export type ServiceApi = ReturnType<typeof createServiceApi>;