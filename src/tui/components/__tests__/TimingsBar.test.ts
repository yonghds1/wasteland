/**
 * TimingsBar.test.ts - TimingsBar 纯函数单元测试
 *
 * 测试 parseTimings / calcSegmentPercentage 等导出辅助函数。
 */

import { describe, it, expect } from 'vitest';
import { calcSegmentPercentage, parseTimings, type Timings } from '../TimingsBar.js';

describe('calcSegmentPercentage', () => {
  it('should calculate percentage correctly', () => {
    expect(calcSegmentPercentage(50, 200)).toBe(25);
  });

  it('should handle zero total gracefully', () => {
    expect(calcSegmentPercentage(0, 0)).toBe(0);
    expect(calcSegmentPercentage(100, 0)).toBe(10000); // 100/1*100
  });

  it('should handle 100% case', () => {
    expect(calcSegmentPercentage(100, 100)).toBe(100);
  });

  it('should return fractional percentages', () => {
    const pct = calcSegmentPercentage(5, 1234);
    expect(pct).toBeCloseTo(0.405, 2);
  });
});

describe('parseTimings', () => {
  const validTimings: Timings = {
    preHookMs: 5,
    permissionMs: 12,
    toolMs: 1190,
    postHookMs: 2,
    totalMs: 1234,
  };

  it('should parse valid timings data', () => {
    const data = { timings: validTimings };
    expect(parseTimings(data)).toEqual(validTimings);
  });

  it('should return null when timings field is missing', () => {
    expect(parseTimings({ other: 'value' })).toBeNull();
  });

  it('should return null when data is null/undefined', () => {
    expect(parseTimings(null)).toBeNull();
    expect(parseTimings(undefined)).toBeNull();
  });

  it('should return null when data is not an object', () => {
    expect(parseTimings('string')).toBeNull();
    expect(parseTimings(42)).toBeNull();
    expect(parseTimings([])).toBeNull();
  });

  it('should default missing numeric fields to 0', () => {
    const partial = { timings: { preHookMs: 5, totalMs: 10 } };
    const result = parseTimings(partial);
    expect(result).toEqual({
      preHookMs: 5,
      permissionMs: 0,
      toolMs: 0,
      postHookMs: 0,
      totalMs: 10,
    });
  });

  it('should default non-numeric fields to 0', () => {
    const malformed = {
      timings: {
        preHookMs: 'fast',
        permissionMs: null,
        toolMs: 100,
        postHookMs: undefined,
        totalMs: 100,
      },
    };
    const result = parseTimings(malformed);
    expect(result).toEqual({
      preHookMs: 0,
      permissionMs: 0,
      toolMs: 100,
      postHookMs: 0,
      totalMs: 100,
    });
  });

  it('should handle nested data shape', () => {
    const nested = { someField: { timings: validTimings } };
    // parseTimings expects timings directly under data; non-matching shape → null
    expect(parseTimings(nested)).toBeNull();
  });
});