/**
 * lru-cache.ts - 简单的 LRU 缓存实现
 *
 * 基于 Map + 数组实现的 LRU（Least Recently Used）缓存。
 * 无外部依赖，简单可靠。
 *
 * ## 使用场景
 *
 * - web-search 结果缓存
 * - 频繁访问的数据缓存
 * - 需要限制内存使用的场景
 *
 * ## 特性
 *
 * - O(1) 时间复杂度的 get/set 操作
 * - 自动清理最旧的条目
 * - 支持配置最大容量
 */

/**
 * LRU 缓存
 *
 * 基于 Map + 数组实现的 LRU 缓存。
 * 当缓存满时，自动删除最久未使用的条目。
 *
 * @example
 * ```typescript
 * const cache = new LRUCache<string>(100);
 *
 * cache.set('key1', 'value1');
 * cache.get('key1'); // 'value1'
 *
 * cache.set('key2', 'value2');
 * cache.size; // 2
 * ```
 */
export class LRUCache<T> {
  private cache = new Map<string, T>();
  private order: string[] = [];

  /**
   * 创建 LRU 缓存
   *
   * @param maxSize - 最大容量（默认 100）
   */
  constructor(private maxSize: number = 100) {
    if (maxSize <= 0) {
      throw new Error('maxSize must be positive');
    }
  }

  /**
   * 获取缓存值
   *
   * 如果键存在，将其移到最新位置并返回值。
   * 如果键不存在，返回 undefined。
   *
   * @param key - 缓存键
   * @returns 缓存值，或 undefined
   */
  get(key: string): T | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }

    // 移到最新位置
    this.order = this.order.filter((k) => k !== key);
    this.order.push(key);

    return this.cache.get(key);
  }

  /**
   * 设置缓存值
   *
   * 如果键已存在，更新值并移到最新位置。
   * 如果键不存在，添加到缓存。如果缓存满，删除最旧的条目。
   *
   * @param key - 缓存键
   * @param value - 缓存值
   */
  set(key: string, value: T): void {
    if (this.cache.has(key)) {
      // 更新现有值
      this.order = this.order.filter((k) => k !== key);
    } else if (this.order.length >= this.maxSize) {
      // 删除最旧的
      const oldest = this.order.shift()!;
      this.cache.delete(oldest);
    }

    this.cache.set(key, value);
    this.order.push(key);
  }

  /**
   * 检查键是否存在
   *
   * @param key - 缓存键
   * @returns 是否存在
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * 删除缓存条目
   *
   * @param key - 缓存键
   * @returns 是否成功删除
   */
  delete(key: string): boolean {
    if (!this.cache.has(key)) {
      return false;
    }

    this.order = this.order.filter((k) => k !== key);
    return this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.order = [];
  }

  /**
   * 获取缓存大小
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * 获取最大容量
   */
  get capacity(): number {
    return this.maxSize;
  }
}
