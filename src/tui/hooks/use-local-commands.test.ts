/**
 * use-local-commands.test.ts - useLocalCommands Hook 单元测试
 *
 * 注意：由于项目没有安装 @testing-library/react，
 * 这些测试只验证模块导出和基本类型。
 * 实际的 Hook 测试需要在集成测试中进行。
 */

import { describe, it, expect } from 'vitest';
import { useLocalCommands } from './use-local-commands.js';

describe('useLocalCommands', () => {
  it('应该导出 useLocalCommands 函数', () => {
    expect(useLocalCommands).toBeDefined();
    expect(typeof useLocalCommands).toBe('function');
  });
});
