# brainstorm: web-search 增强

## Goal

增强 wasteland 的 web-search 工具，替换脆弱的正则解析为专业 HTML 解析器（cheerio），添加搜索结果缓存，提升搜索可靠性和性能。

## Requirements

### 功能需求

1. **cheerio HTML 解析**
   - 使用 cheerio 替换现有的正则表达式解析
   - 保持相同的搜索结果格式（标题、URL、摘要）
   - 处理 DuckDuckGo HTML 结构变化

2. **内存 LRU 缓存**
   - 实现简单的 LRU 缓存（Map + 数组）
   - 缓存搜索结果（基于查询字符串）
   - 支持缓存大小限制（默认 100 条）
   - 无 TTL（结果始终有效，直到缓存满）

### 非功能需求

1. **兼容性**：保持与现有 web-search 工具的完全兼容
2. **性能**：缓存命中时响应时间 < 10ms
3. **类型安全**：完整的 TypeScript 类型定义

## Acceptance Criteria

- [ ] cheerio 可以正确解析 DuckDuckGo HTML
- [ ] 搜索结果格式与现有格式完全一致
- [ ] LRU 缓存可以正确存储和检索结果
- [ ] 缓存满时自动清理最旧的条目
- [ ] 所有现有 336 个测试通过
- [ ] 新增 web-search 相关的单元测试
- [ ] TypeScript 编译无错误

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes

## Out of Scope (explicit)

* TTL 缓存（过期时间）
* 备用搜索引擎（Brave Search 等）
* 重试逻辑（指数退避）
* 速率限制
* 插件架构

## Technical Approach

### cheerio 解析

```typescript
// 现有代码（正则解析）
const titleMatch = html.match(/<a[^>]*class="result__a"[^>]*>([^<]*)<\/a>/);

// 新代码（cheerio 解析）
import * as cheerio from 'cheerio';
const $ = cheerio.load(html);
const title = $('.result__a').text().trim();
const url = $('.result__a').attr('href');
const snippet = $('.result__snippet').text().trim();
```

### LRU 缓存

```typescript
class LRUCache<T> {
  private cache = new Map<string, T>();
  private order: string[] = [];
  
  constructor(private maxSize: number = 100) {}
  
  get(key: string): T | undefined {
    if (!this.cache.has(key)) return undefined;
    // 移到最新位置
    this.order = this.order.filter(k => k !== key);
    this.order.push(key);
    return this.cache.get(key);
  }
  
  set(key: string, value: T): void {
    if (this.cache.has(key)) {
      this.order = this.order.filter(k => k !== key);
    } else if (this.order.length >= this.maxSize) {
      // 删除最旧的
      const oldest = this.order.shift()!;
      this.cache.delete(oldest);
    }
    this.cache.set(key, value);
    this.order.push(key);
  }
}
```

## Implementation Plan (small PRs)

### PR1: cheerio 解析
- 安装 cheerio 依赖
- 在 web-search.ts 中使用 cheerio 替换正则解析
- 保持搜索结果格式不变
- 添加 cheerio 解析相关测试

### PR2: LRU 缓存
- 实现 LRUCache 类
- 在 web-search.ts 中集成缓存
- 添加缓存相关测试

### PR3: 集成测试 + 文档
- 添加端到端集成测试
- 更新 README 和用户指南
- 更新 CHANGELOG

## Technical Notes

* 关键文件：`src/tools/web-search.ts`
* 依赖：cheerio（npm 包）
* 代码库路径：/home/ubuntu/workspace/wasteland
* Trellis 管理：.trellis/ 目录
