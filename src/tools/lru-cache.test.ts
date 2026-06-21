/**
 * LRU 缓存测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCache } from './lru-cache.js';

describe('LRUCache', () => {
  let cache: LRUCache<string>;

  beforeEach(() => {
    cache = new LRUCache<string>(3);
  });

  describe('基本操作', () => {
    it('should set and get values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
    });

    it('should delete values', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should return false when deleting non-existent key', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should clear all values', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe('容量管理', () => {
    it('should report correct size', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size).toBe(2);
    });

    it('should report correct capacity', () => {
      expect(cache.capacity).toBe(3);
    });

    it('should evict oldest entry when full', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4'); // 应该驱逐 key1

      expect(cache.size).toBe(3);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key4')).toBe('value4');
    });

    it('should maintain LRU order on get', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // 访问 key1，使其变为最新
      cache.get('key1');

      cache.set('key4', 'value4'); // 应该驱逐 key2（最旧）

      expect(cache.get('key1')).toBe('value1'); // 仍然存在
      expect(cache.get('key2')).toBeUndefined(); // 被驱逐
    });

    it('should maintain LRU order on set (update)', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // 更新 key1，使其变为最新
      cache.set('key1', 'value1-updated');

      cache.set('key4', 'value4'); // 应该驱逐 key2（最旧）

      expect(cache.get('key1')).toBe('value1-updated'); // 仍然存在
      expect(cache.get('key2')).toBeUndefined(); // 被驱逐
    });
  });

  describe('边界情况', () => {
    it('should throw error for invalid maxSize', () => {
      expect(() => new LRUCache(0)).toThrow('maxSize must be positive');
      expect(() => new LRUCache(-1)).toThrow('maxSize must be positive');
    });

    it('should work with maxSize of 1', () => {
      const smallCache = new LRUCache<string>(1);
      smallCache.set('key1', 'value1');
      smallCache.set('key2', 'value2');

      expect(smallCache.size).toBe(1);
      expect(smallCache.get('key1')).toBeUndefined();
      expect(smallCache.get('key2')).toBe('value2');
    });

    it('should handle empty string keys', () => {
      cache.set('', 'empty');
      expect(cache.get('')).toBe('empty');
    });

    it('should handle special characters in keys', () => {
      cache.set('key with spaces', 'value1');
      cache.set('key/with/slashes', 'value2');
      cache.set('key?with=special&chars', 'value3');

      expect(cache.get('key with spaces')).toBe('value1');
      expect(cache.get('key/with/slashes')).toBe('value2');
      expect(cache.get('key?with=special&chars')).toBe('value3');
    });
  });
});
