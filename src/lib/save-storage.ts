/**
 * 存档存储编解码（Save Storage Codec）
 * ----------------------------------------------------------------------------
 * 目标：在 IndexedDB 中以「压缩字符串」方式存储存档，显著缩减体积；
 *       同时保持对旧存档（未压缩、直接存 SaveData 对象）的向后兼容。
 *
 * 存储记录结构：
 *   {
 *     slotId: number,
 *     codec: 'lz' | 'raw',      // lz = LZString 压缩后的字符串；raw = 旧格式（SaveData 对象）
 *     saveTime, dayCount, totalAsset, roi,   // 摘要字段（用于读档列表，无需解压）
 *     payload: string | SaveData
 *   }
 *
 * 注意：本模块只做序列化 / 反序列化，不参与任何游戏逻辑计算。
 */
import LZString from 'lz-string';
import type { SaveData } from '../types';

/** 当前压缩格式版本标记 */
export const SAVE_CODEC_LZ = 'lz';

/** IndexedDB 中实际存储的记录结构 */
export interface StoredSlotRecord {
  slotId: number;
  codec: string;
  saveTime: number;
  dayCount: number;
  totalAsset: number;
  roi: number;
  payload: string | SaveData;
}

/** 读档列表需要的摘要 */
export interface SlotSummary {
  slotId: number;
  exists: boolean;
  saveTime: number;
  dayCount: number;
  totalAsset: number;
  roi: number;
}

/**
 * 把 SaveData 打包成待写入 IndexedDB 的记录（JSON → LZString 压缩）。
 */
export function packSaveRecord(saveData: SaveData): StoredSlotRecord {
  const json = JSON.stringify(saveData);
  let payload: string = json;
  let codec = 'raw';
  try {
    const compressed = LZString.compressToUTF16(json);
    // 极小存档压缩反而可能变大，做一次保护性判断
    if (typeof compressed === 'string' && compressed.length > 0 && compressed.length < json.length) {
      payload = compressed;
      codec = SAVE_CODEC_LZ;
    }
  } catch (e) {
    // 压缩失败则退回明文，保证存档不丢失
    payload = json;
    codec = 'raw';
  }
  return {
    slotId: saveData.slotId,
    codec,
    saveTime: saveData.saveTime || 0,
    dayCount: saveData.dayCount || 0,
    totalAsset: saveData.totalAsset || 0,
    roi: saveData.roi || 0,
    payload,
  };
}

/** 判断一条 IndexedDB 记录是否为新格式（带 payload 字段） */
function isPackedRecord(record: any): boolean {
  return !!record && typeof record === 'object' && 'payload' in record && typeof record.codec === 'string';
}

/**
 * 从 IndexedDB 记录还原 SaveData。
 * 兼容：
 *  - 新格式 { codec, payload }
 *  - 旧格式：直接就是 SaveData 对象
 */
export function unpackSaveRecord(record: any): SaveData | undefined {
  if (!record) return undefined;
  if (!isPackedRecord(record)) {
    // 旧存档：本身即 SaveData
    return record as SaveData;
  }
  try {
    if (record.codec === SAVE_CODEC_LZ) {
      const json = LZString.decompressFromUTF16(record.payload as string);
      if (!json) return undefined;
      return JSON.parse(json) as SaveData;
    }
    // codec === 'raw'：payload 为 JSON 字符串
    if (typeof record.payload === 'string') {
      return JSON.parse(record.payload) as SaveData;
    }
    return record.payload as SaveData;
  } catch (e) {
    console.error('存档解压失败:', e);
    return undefined;
  }
}

/**
 * 读取存档摘要（不解压 payload，读档列表用）。
 * 旧存档只有对象本身，直接取字段。
 */
export function readSlotSummary(record: any, slotId: number): SlotSummary {
  if (!record) {
    return { slotId, exists: false, saveTime: 0, dayCount: 0, totalAsset: 0, roi: 0 };
  }
  if (isPackedRecord(record)) {
    return {
      slotId,
      exists: true,
      saveTime: record.saveTime || 0,
      dayCount: record.dayCount || 0,
      totalAsset: record.totalAsset || 0,
      roi: record.roi || 0,
    };
  }
  return {
    slotId,
    exists: true,
    saveTime: record.saveTime || 0,
    dayCount: record.dayCount || 0,
    totalAsset: record.totalAsset || 0,
    roi: record.roi || 0,
  };
}

/** 估算压缩率（仅用于诊断输出，不影响存档） */
export function estimateCompression(json: string): { originalBytes: number; compressedBytes: number; ratio: number } {
  const originalBytes = new Blob([json]).size;
  let compressed = json;
  try {
    compressed = LZString.compressToUTF16(json);
  } catch (e) {
    compressed = json;
  }
  const compressedBytes = new Blob([compressed]).size;
  return {
    originalBytes,
    compressedBytes,
    ratio: originalBytes > 0 ? compressedBytes / originalBytes : 1,
  };
}
