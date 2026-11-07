/**
 * 性能优化工具模块
 * 包含计时器、对象池、时间切片等工具
 */

// ============ 计时工具 ============
interface TimingSegment {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

class PerformanceTimer {
  private segments: Map<string, TimingSegment> = new Map();
  private results: TimingSegment[] = [];
  private enabled: boolean = false; // 生产环境默认关闭

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  start(name: string) {
    if (!this.enabled) return;
    this.segments.set(name, {
      name,
      startTime: performance.now(),
    });
  }

  end(name: string) {
    if (!this.enabled) return;
    const segment = this.segments.get(name);
    if (segment) {
      segment.endTime = performance.now();
      segment.duration = segment.endTime - segment.startTime;
      this.results.push(segment);
      this.segments.delete(name);
    }
  }

  getResults(): TimingSegment[] {
    return [...this.results];
  }

  clearResults() {
    this.results = [];
    this.segments.clear();
  }

  printResults() {
    if (!this.enabled || this.results.length === 0) return;
    console.log('=== Performance Timing Results ===');
    this.results.forEach(r => {
      if (r.duration !== undefined) {
        console.log(`${r.name}: ${r.duration.toFixed(2)}ms`);
      }
    });
    const total = this.results.reduce((sum, r) => sum + (r.duration || 0), 0);
    console.log(`Total: ${total.toFixed(2)}ms`);
  }
}

export const perfTimer = new PerformanceTimer();

// ============ 对象池 ============
interface Poolable {
  reset(): void;
}

class ObjectPool<T extends Poolable> {
  private pool: T[] = [];
  private factory: () => T;
  private maxSize: number;

  constructor(factory: () => T, maxSize: number = 100) {
    this.factory = factory;
    this.maxSize = maxSize;
  }

  acquire(): T {
    if (this.pool.length > 0) {
      const obj = this.pool.pop()!;
      obj.reset();
      return obj;
    }
    return this.factory();
  }

  release(obj: T) {
    if (this.pool.length < this.maxSize) {
      obj.reset();
      this.pool.push(obj);
    }
  }

  releaseAll(objects: T[]) {
    objects.forEach(obj => this.release(obj));
  }

  getPoolSize(): number {
    return this.pool.length;
  }
}

// ============ 时间切片执行器 ============
type Task = () => boolean | void; // 返回 true 表示任务完成，false 表示需要继续执行

class TimeSlicer {
  private taskQueue: Task[] = [];
  private isRunning: boolean = false;
  private maxFrameTime: number; // 每帧最大执行时间（毫秒）
  private onProgress?: (completed: number, total: number) => void;
  private onComplete?: () => void;

  constructor(maxFrameTime: number = 8) {
    this.maxFrameTime = maxFrameTime;
  }

  addTask(task: Task) {
    this.taskQueue.push(task);
  }

  addTasks(tasks: Task[]) {
    this.taskQueue.push(...tasks);
  }

  setCallbacks(onProgress?: (completed: number, total: number) => void, onComplete?: () => void) {
    this.onProgress = onProgress;
    this.onComplete = onComplete;
  }

  private runFrame = () => {
    if (this.taskQueue.length === 0) {
      this.isRunning = false;
      this.onComplete?.();
      return;
    }

    const frameStart = performance.now();
    let completedThisFrame = 0;
    const totalTasks = this.taskQueue.length;

    while (this.taskQueue.length > 0) {
      const elapsed = performance.now() - frameStart;
      if (elapsed >= this.maxFrameTime) {
        // 超时，下一帧继续
        break;
      }

      const task = this.taskQueue[0];
      const result = task();

      if (result === true || result === undefined) {
        // 任务完成
        this.taskQueue.shift();
        completedThisFrame++;
      }
      // 如果返回 false，任务未完成，保留在队列头部，下一帧继续
    }

    if (this.onProgress) {
      this.onProgress(totalTasks - this.taskQueue.length, totalTasks);
    }

    if (this.taskQueue.length > 0) {
      requestAnimationFrame(this.runFrame);
    } else {
      this.isRunning = false;
      this.onComplete?.();
    }
  };

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    requestAnimationFrame(this.runFrame);
  }

  stop() {
    this.isRunning = false;
    this.taskQueue = [];
  }

  getQueueLength(): number {
    return this.taskQueue.length;
  }

  isProcessing(): boolean {
    return this.isRunning;
  }
}

export const createTimeSlicer = (maxFrameTime?: number) => new TimeSlicer(maxFrameTime);

// ============ 批量状态更新器 ============
interface BatchUpdate {
  type: string;
  payload: any;
}

class BatchStateUpdater {
  private updates: BatchUpdate[] = [];
  private flushThreshold: number;

  constructor(flushThreshold: number = 50) {
    this.flushThreshold = flushThreshold;
  }

  add(type: string, payload: any) {
    this.updates.push({ type, payload });
    if (this.updates.length >= this.flushThreshold) {
      return this.flush();
    }
    return null;
  }

  addMany(updates: BatchUpdate[]) {
    this.updates.push(...updates);
    if (this.updates.length >= this.flushThreshold) {
      return this.flush();
    }
    return null;
  }

  flush(): BatchUpdate[] {
    const result = [...this.updates];
    this.updates = [];
    return result;
  }

  clear() {
    this.updates = [];
  }

  size(): number {
    return this.updates.length;
  }
}

export const createBatchUpdater = (flushThreshold: number = 50) => new BatchStateUpdater(flushThreshold);

// ============ 滚动窗口计算器 ============
class RollingWindowCalculator {
  private windowSize: number;
  private values: number[] = [];
  private sum: number = 0;

  constructor(windowSize: number) {
    this.windowSize = windowSize;
  }

  add(value: number): number {
    // O(1) 滚动窗口计算
    this.values.push(value);
    this.sum += value;

    if (this.values.length > this.windowSize) {
      const removed = this.values.shift()!;
      this.sum -= removed;
    }

    return this.sum / this.values.length;
  }

  getAverage(): number {
    if (this.values.length === 0) return 0;
    return this.sum / this.values.length;
  }

  getSum(): number {
    return this.sum;
  }

  getCount(): number {
    return this.values.length;
  }

  reset() {
    this.values = [];
    this.sum = 0;
  }
}

export const createRollingWindow = (windowSize: number) => new RollingWindowCalculator(windowSize);

// ============ 桶分层订单撮合 ============
interface OrderBucket {
  price: number;
  quantity: number;
  orders: { id: string; quantity: number }[];
}

class BucketOrderMatcher {
  private bidBuckets: Map<number, OrderBucket> = new Map(); // 买单桶（价格 -> 桶）
  private askBuckets: Map<number, OrderBucket> = new Map(); // 卖单桶（价格 -> 桶）
  private pricePrecision: number;

  constructor(pricePrecision: number = 0.01) {
    this.pricePrecision = pricePrecision;
  }

  private normalizePrice(price: number): number {
    return Math.round(price / this.pricePrecision) * this.pricePrecision;
  }

  addBid(price: number, quantity: number, orderId: string = '') {
    const normalizedPrice = this.normalizePrice(price);
    const bucket = this.bidBuckets.get(normalizedPrice);
    if (bucket) {
      bucket.quantity += quantity;
      if (orderId) bucket.orders.push({ id: orderId, quantity });
    } else {
      this.bidBuckets.set(normalizedPrice, {
        price: normalizedPrice,
        quantity,
        orders: orderId ? [{ id: orderId, quantity }] : [],
      });
    }
  }

  addAsk(price: number, quantity: number, orderId: string = '') {
    const normalizedPrice = this.normalizePrice(price);
    const bucket = this.askBuckets.get(normalizedPrice);
    if (bucket) {
      bucket.quantity += quantity;
      if (orderId) bucket.orders.push({ id: orderId, quantity });
    } else {
      this.askBuckets.set(normalizedPrice, {
        price: normalizedPrice,
        quantity,
        orders: orderId ? [{ id: orderId, quantity }] : [],
      });
    }
  }

  // 匹配订单：返回成交记录
  match(): { price: number; quantity: number; side: 'buy' | 'sell' }[] {
    const fills: { price: number; quantity: number; side: 'buy' | 'sell' }[] = [];

    // 获取最优买价和卖价
    const sortedBidPrices = Array.from(this.bidBuckets.keys()).sort((a, b) => b - a); // 降序
    const sortedAskPrices = Array.from(this.askBuckets.keys()).sort((a, b) => a - b); // 升序

    if (sortedBidPrices.length === 0 || sortedAskPrices.length === 0) {
      return fills;
    }

    const bestBidPrice = sortedBidPrices[0];
    const bestAskPrice = sortedAskPrices[0];

    // 只有当买价 >= 卖价时才成交
    if (bestBidPrice >= bestAskPrice) {
      const bidBucket = this.bidBuckets.get(bestBidPrice)!;
      const askBucket = this.askBuckets.get(bestAskPrice)!;

      const matchQuantity = Math.min(bidBucket.quantity, askBucket.quantity);
      const matchPrice = (bestBidPrice + bestAskPrice) / 2; // 中间价成交

      fills.push({
        price: matchPrice,
        quantity: matchQuantity,
        side: 'buy',
      });

      // 更新桶
      bidBucket.quantity -= matchQuantity;
      askBucket.quantity -= matchQuantity;

      // 移除空桶
      if (bidBucket.quantity <= 0) {
        this.bidBuckets.delete(bestBidPrice);
      }
      if (askBucket.quantity <= 0) {
        this.askBuckets.delete(bestAskPrice);
      }
    }

    return fills;
  }

  getBestBid(): { price: number; quantity: number } | null {
    const sortedPrices = Array.from(this.bidBuckets.keys()).sort((a, b) => b - a);
    if (sortedPrices.length === 0) return null;
    const bucket = this.bidBuckets.get(sortedPrices[0])!;
    return { price: bucket.price, quantity: bucket.quantity };
  }

  getBestAsk(): { price: number; quantity: number } | null {
    const sortedPrices = Array.from(this.askBuckets.keys()).sort((a, b) => a - b);
    if (sortedPrices.length === 0) return null;
    const bucket = this.askBuckets.get(sortedPrices[0])!;
    return { price: bucket.price, quantity: bucket.quantity };
  }

  clear() {
    this.bidBuckets.clear();
    this.askBuckets.clear();
  }

  getBidBuckets(): OrderBucket[] {
    return Array.from(this.bidBuckets.values()).sort((a, b) => b.price - a.price);
  }

  getAskBuckets(): OrderBucket[] {
    return Array.from(this.askBuckets.values()).sort((a, b) => a.price - b.price);
  }
}

export const createBucketMatcher = (pricePrecision?: number) => new BucketOrderMatcher(pricePrecision);

// ============ 增量统计器 ============
class IncrementalStats {
  private sum: number = 0;
  private count: number = 0;
  private min: number = Infinity;
  private max: number = -Infinity;
  private lastValue: number = 0;

  add(value: number) {
    this.sum += value;
    this.count++;
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
    this.lastValue = value;
  }

  addDelta(delta: number) {
    this.sum += delta;
    this.lastValue += delta;
    // min/max 不更新（因为增量无法确定新的极值）
  }

  getSum(): number {
    return this.sum;
  }

  getAverage(): number {
    return this.count > 0 ? this.sum / this.count : 0;
  }

  getMin(): number {
    return this.count > 0 ? this.min : 0;
  }

  getMax(): number {
    return this.count > 0 ? this.max : 0;
  }

  getLastValue(): number {
    return this.lastValue;
  }

  getCount(): number {
    return this.count;
  }

  reset() {
    this.sum = 0;
    this.count = 0;
    this.min = Infinity;
    this.max = -Infinity;
    this.lastValue = 0;
  }
}

export const createIncrementalStats = () => new IncrementalStats();

// ============ 数组复用工具 ============
export class ReusableArray<T> {
  private data: T[];
  private length: number = 0;
  private capacity: number;

  constructor(capacity: number = 100) {
    this.capacity = capacity;
    this.data = new Array(capacity);
  }

  push(item: T) {
    if (this.length < this.capacity) {
      this.data[this.length++] = item;
    }
  }

  pop(): T | undefined {
    if (this.length > 0) {
      return this.data[--this.length];
    }
    return undefined;
  }

  clear() {
    this.length = 0;
  }

  getLength(): number {
    return this.length;
  }

  toArray(): T[] {
    return this.data.slice(0, this.length);
  }

  forEach(callback: (item: T, index: number) => void) {
    for (let i = 0; i < this.length; i++) {
      callback(this.data[i], i);
    }
  }

  map<R>(callback: (item: T, index: number) => R): R[] {
    const result: R[] = [];
    for (let i = 0; i < this.length; i++) {
      result.push(callback(this.data[i], i));
    }
    return result;
  }

  filter(callback: (item: T, index: number) => boolean): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.length; i++) {
      if (callback(this.data[i], i)) {
        result.push(this.data[i]);
      }
    }
    return result;
  }
}

// ============ 深拷贝优化：选择性拷贝 ============
export function shallowCopy<T extends object>(obj: T): T {
  if (Array.isArray(obj)) {
    return [...obj] as T;
  }
  return { ...obj };
}

// 选择性拷贝：只拷贝需要的字段
export function pickFields<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  keys.forEach(key => {
    result[key] = obj[key];
  });
  return result;
}

// ============ 防抖和节流 ============
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// ============ 批量执行器 ============
export async function executeBatch<T, R>(
  items: T[],
  processor: (item: T) => R,
  batchSize: number = 10
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    results.push(...batch.map(processor));
    // 让出主线程
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  return results;
}