import { describe, it, expect } from 'vitest';
import { parseMouseEvent } from '../mouse-protocol.js';

describe('mouse-protocol', () => {
  it('正确解析 SGR 协议滚轮向上 (button 64)', () => {
    const event = parseMouseEvent('\x1b[<64;25;10M');
    expect(event).toEqual({
      kind: 'wheel-up',
      x: 25,
      y: 10,
    });
  });

  it('正确解析 SGR 协议滚轮向下 (button 65)', () => {
    const event = parseMouseEvent('\x1b[<65;100;40M');
    expect(event).toEqual({
      kind: 'wheel-down',
      x: 100,
      y: 40,
    });
  });

  it('正确解析 SGR 协议鼠标左键按下 (button 0, action M)', () => {
    const event = parseMouseEvent('\x1b[<0;10;5M');
    expect(event).toEqual({
      kind: 'down',
      x: 10,
      y: 5,
    });
  });

  it('正确解析 SGR 协议鼠标左键拖拽移动 (button 32, action M)', () => {
    const event = parseMouseEvent('\x1b[<32;10;15M');
    expect(event).toEqual({
      kind: 'drag',
      x: 10,
      y: 15,
    });
  });

  it('正确解析 SGR 协议鼠标释放 (action m)', () => {
    const event = parseMouseEvent('\x1b[<0;10;15m');
    expect(event).toEqual({
      kind: 'up',
      x: 10,
      y: 15,
    });
  });

  it('非鼠标序列返回 null', () => {
    expect(parseMouseEvent('')).toBeNull();
    expect(parseMouseEvent('hello')).toBeNull();
    expect(parseMouseEvent('\x1b[A')).toBeNull(); // Arrow Up
  });
});
