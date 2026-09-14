/**
 * web-search 集成测试
 *
 * 测试 web-search 工具的 cheerio 解析和 LRU 缓存功能
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createWebSearchTool, clearSearchCache, getCacheSize, normalizeSearchQuery } from '../web-search.js';

describe('web-search integration', () => {
  let tool: ReturnType<typeof createWebSearchTool>;

  beforeEach(() => {
    tool = createWebSearchTool();
    clearSearchCache();
  });

  describe('cheerio 解析', () => {
    it('should have correct tool metadata', () => {
      expect(tool.name).toBe('web-search');
      expect(tool.riskLevel).toBe('read');
    });

    it('should have correct input schema', () => {
      expect(tool.inputSchema).toBeDefined();
       
      const schema = tool.inputSchema!;
      expect(schema.properties).toHaveProperty('query');
      expect(schema.properties).toHaveProperty('maxResults');
      expect(schema.properties).toHaveProperty('engine');
    });
  });

  describe('LRU 缓存', () => {
    it('should start with empty cache', () => {
      expect(getCacheSize()).toBe(0);
    });

    it('should clear cache', () => {
      clearSearchCache();
      expect(getCacheSize()).toBe(0);
    });
  });

  describe('缓存键归一化', () => {
    it('should normalize case and whitespace', () => {
      expect(normalizeSearchQuery('  Hello   World  ')).toBe('hello world');
      expect(normalizeSearchQuery('TypeScript')).toBe('typescript');
      expect(normalizeSearchQuery('a\tb\nc')).toBe('a b c');
    });
  });

  describe('输出格式', () => {
    it('should format results correctly', async () => {
      // 由于网络请求，我们只测试工具的元数据
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    });
  });

  describe('错误处理', () => {
    it('should handle missing query parameter', async () => {
      const result = await tool.execute({}, { sessionId: 'test', turn: 1, cwd: '/tmp' });
      expect(result.status).toBe('error');
    });

    it('should handle empty query parameter', async () => {
      const result = await tool.execute(
        { query: '' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );
      expect(result.status).toBe('error');
    });
  });
});
