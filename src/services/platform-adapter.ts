/**
 * 平台适配器（Platform Adapter）
 * ----------------------------------------------------------------------------
 * 目标：把业务代码与「灵光闪应用（lingguang）」平台 API 解耦。
 *
 * 设计原则：
 * - 业务代码只依赖本文件的 `platform` 接口，不再直接访问 `window.lingguang`。
 * - 运行时自动探测平台能力：
 *     · 存在 window.lingguang → 走平台原生能力（保存文件 / 存储 / 音效 / 路由）
 *     · 不存在 → 自动降级为浏览器原生实现（Blob 下载 / localStorage / WebAudio）
 * - 所有方法都是「能力探测 + 降级」，失败时返回失败结果而不抛异常（调用方按需处理）。
 *
 * 说明：本文件不改变任何游戏业务逻辑，只做 IO 能力抽象。
 */

/** 平台类型 */
export type PlatformKind = 'lingguang' | 'browser';

/** 保存文本文件的结果 */
export interface SaveTextFileResult {
  success: boolean;
  /** 降级到浏览器下载时为 true（便于 UI 提示差异） */
  fallback: boolean;
  error?: string;
}

/** 通用键值存储结果 */
export interface KvResult {
  success: boolean;
  error?: string;
}

/** lingguang 平台对象的最小结构（只声明本适配器用到的能力） */
interface LingguangLike {
  saveFile?: (opts: { data: string; fileName: string }) => Promise<unknown> | unknown;
  storage?: {
    setItem?: (key: string, value: string) => unknown;
    getItem?: (key: string) => unknown;
    removeItem?: (key: string) => unknown;
  };
  monitor?: { event?: (name: string, payload?: unknown) => unknown };
  navigate?: { to?: (path: string) => unknown };
  playAudio?: (opts: unknown) => unknown;
}

/** 读取全局 lingguang（不存在返回 null） */
function getLingguang(): LingguangLike | null {
  try {
    const g = (typeof window !== 'undefined' ? (window as any).lingguang : null) as LingguangLike | null;
    return g && typeof g === 'object' ? g : null;
  } catch (e) {
    return null;
  }
}

/** 当前运行在哪个平台上 */
export function detectPlatform(): PlatformKind {
  return getLingguang() ? 'lingguang' : 'browser';
}

/** UTF-8 字符串 → base64（分块，避免大文档爆栈） */
function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

/** 浏览器降级：用 <a download> 触发本地下载 */
function browserDownloadTextFile(fileName: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // 稍后回收，避免下载被中断
  setTimeout(() => {
    try {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      /* ignore */
    }
  }, 5000);
}

/** 简易本地键值封装（localStorage 可能被禁用，需 try/catch） */
const localKv = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  },
  remove(key: string): boolean {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  },
};

/**
 * 平台能力统一入口。
 * 业务代码统一通过 `platform.xxx()` 调用，不再直接使用 window.lingguang。
 */
export const platform = {
  /** 当前平台 */
  get kind(): PlatformKind {
    return detectPlatform();
  },

  /** 是否处于灵光平台内 */
  get hasLingguang(): boolean {
    return getLingguang() !== null;
  },

  /**
   * 保存文本文件（如交接文档 Markdown）。
   * - lingguang：转 base64 后交给平台 saveFile
   * - 浏览器：Blob + <a download> 降级
   */
  async saveTextFile(fileName: string, text: string, mime = 'text/plain;charset=utf-8'): Promise<SaveTextFileResult> {
    const lg = getLingguang();
    if (lg && typeof lg.saveFile === 'function') {
      try {
        await lg.saveFile({ data: textToBase64(text), fileName });
        return { success: true, fallback: false };
      } catch (err) {
        // 平台调用失败时继续尝试浏览器降级，保证用户仍能拿到文件
        try {
          browserDownloadTextFile(fileName, text, mime);
          return { success: true, fallback: true, error: (err as any)?.message };
        } catch (err2) {
          return { success: false, fallback: false, error: (err2 as any)?.message || String(err2) };
        }
      }
    }
    try {
      browserDownloadTextFile(fileName, text, mime);
      return { success: true, fallback: true };
    } catch (err) {
      return { success: false, fallback: true, error: (err as any)?.message || String(err) };
    }
  },

  /** 键值写入（优先平台存储，其次 localStorage） */
  setItem(key: string, value: string): KvResult {
    const lg = getLingguang();
    if (lg?.storage?.setItem) {
      try {
        lg.storage.setItem(key, value);
        return { success: true };
      } catch (e) {
        /* 继续降级 */
      }
    }
    return localKv.set(key, value) ? { success: true } : { success: false, error: 'storage unavailable' };
  },

  /** 键值读取 */
  getItem(key: string): string | null {
    const lg = getLingguang();
    if (lg?.storage?.getItem) {
      try {
        const v = lg.storage.getItem(key);
        if (typeof v === 'string') return v;
      } catch (e) {
        /* 继续降级 */
      }
    }
    return localKv.get(key);
  },

  /** 键值删除 */
  removeItem(key: string): KvResult {
    const lg = getLingguang();
    if (lg?.storage?.removeItem) {
      try {
        lg.storage.removeItem(key);
        return { success: true };
      } catch (e) {
        /* 继续降级 */
      }
    }
    return localKv.remove(key) ? { success: true } : { success: false };
  },

  /** 路由跳转（平台内）；无平台能力时退化为 hash 赋值，不抛错 */
  navigateTo(path: string): void {
    const lg = getLingguang();
    try {
      if (lg?.navigate?.to) {
        lg.navigate.to(path);
        return;
      }
      if (typeof window !== 'undefined') {
        window.location.hash = path;
      }
    } catch (e) {
      /* ignore */
    }
  },

  /** 埋点事件（无平台时静默丢弃） */
  track(eventName: string, payload?: unknown): void {
    const lg = getLingguang();
    try {
      lg?.monitor?.event?.(eventName, payload);
    } catch (e) {
      /* ignore */
    }
  },

  /**
   * 播放提示音。
   * - lingguang 有 playAudio 则透传
   * - 否则用 WebAudio 生成一个极短提示音（不引入音频资源，保持单文件离线可用）
   */
  /**
   * 播放提示音。
   * 注意：平台脚手架禁止直接使用 AudioContext / webkitAudioContext（构建期拦截），
   * 合成音效必须走 `@/lib/audio` 或 `@/lib/tone` wrapper；本项目当前无音频需求，
   * 因此这里只做「平台能力探测 + 安全空实现」，不引入任何音频 API。
   */
  playSound(kind: 'success' | 'error' | 'click' = 'click'): void {
    const lg = getLingguang();
    if (lg && typeof lg.playAudio === 'function') {
      try {
        lg.playAudio({ name: kind });
      } catch (e) {
        /* 静默失败，不影响游戏主流程 */
      }
    }
    // 浏览器环境下无音频资产，保持静默（如需音效请接入 @/lib/audio）
  },
};

export default platform;
