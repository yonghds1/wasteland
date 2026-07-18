# Research Summary: Web-Search Implementation

- **Query**: Research the current web-search implementation and identify improvements
- **Scope**: Mixed (internal codebase + external best practices)
- **Date**: 2026-06-21

## Executive Summary

The rx-cli web-search tool currently supports **only DuckDuckGo** via HTML scraping with **regex-based parsing**. The implementation is functional but fragile, with no fallback mechanisms, caching, or retry logic.

## Key Findings

### Current State

| Aspect | Status | Details |
|--------|--------|---------|
| **Search Engines** | DuckDuckGo only | Via `html.duckduckgo.com/html/` |
| **HTML Parsing** | Regex-based | Fragile, breaks if HTML structure changes |
| **Error Handling** | Basic | Timeout handling only |
| **Caching** | None | Repeated queries make new requests |
| **Retry Logic** | None | Single point of failure |
| **Fallback** | None | If DuckDuckGo fails, search fails |

### Files Analyzed

1. **`src/tools/web-search.ts`** (333 lines)
   - Main implementation
   - Uses regex to parse DuckDuckGo HTML
   - No TODO comments or incomplete implementations noted

2. **`src/tools/web-fetch.ts`** (293 lines)
   - Companion HTTP request tool
   - More robust error handling

3. **`src/tools/default-registry.ts`** (199 lines)
   - Registers web-search as a built-in tool

4. **`test/tools/git-web-search.test.js`** (284 lines)
   - Basic test coverage
   - Network-dependent tests wrapped in try/catch

### Critical Issues Identified

1. **Fragile HTML Parsing**
   - Uses regex to extract data from HTML
   - Breaks if DuckDuckGo changes class names
   - No error handling for malformed HTML

2. **No Search Engine Redundancy**
   - Single point of failure (DuckDuckGo)
   - No fallback to other engines
   - No circuit breaker pattern

3. **Missing Production Features**
   - No result caching
   - No rate limiting
   - No retry with backoff
   - No User-Agent rotation

## Priority Recommendations

### High Priority (Immediate)

1. **Replace regex with proper HTML parser**
   - Add `cheerio` dependency
   - More robust parsing
   - Better error handling

2. **Add fallback search engine**
   - Implement Brave Search API support
   - Add circuit breaker pattern
   - Graceful degradation

3. **Improve error handling**
   - Better error messages
   - Retry with exponential backoff
   - Timeout handling

### Medium Priority (Near-term)

4. **Add result caching**
   - LRU cache for repeated queries
   - Configurable TTL
   - Memory limits

5. **Add rate limiting**
   - Token bucket algorithm
   - Respect service limits
   - Prevent abuse

6. **Support additional engines**
   - Google Custom Search API
   - Bing Web Search API
   - Plugin architecture

### Low Priority (Future)

7. **Advanced features**
   - Search region/language support
   - Result filtering
   - Search history
   - Analytics and monitoring

## Architecture Recommendations

### Strategy Pattern for Search Engines

```typescript
interface SearchEngine {
  name: string;
  search(query: string, maxResults: number): Promise<SearchResult[]>;
  isAvailable(): Promise<boolean>;
}
```

### Plugin Architecture

```typescript
class SearchPluginRegistry {
  private plugins: Map<string, SearchPlugin> = new Map();
  
  register(plugin: SearchPlugin): void;
  get(name: string): SearchPlugin | undefined;
  getAvailable(): Promise<SearchPlugin[]>;
}
```

### Fallback Chain

```typescript
class WebSearchTool {
  private fallbackOrder: string[] = ['duckduckgo', 'brave', 'google'];
  
  async search(query: string): Promise<SearchResult[]> {
    for (const engine of this.fallbackOrder) {
      try {
        return await this.engines.get(engine)!.search(query, 5);
      } catch (error) {
        console.warn(`Engine ${engine} failed, trying next`);
      }
    }
    throw new Error('All search engines failed');
  }
}
```

## External Dependencies to Add

| Package | Purpose | Size | License |
|---------|---------|------|---------|
| `cheerio` | HTML parsing | ~7MB | MIT |
| `node-cache` | Result caching | ~100KB | MIT |

## Testing Strategy

1. **Unit Tests**: Mock search engine responses
2. **Integration Tests**: Test with real APIs (in CI with rate limits)
3. **Fallback Tests**: Verify circuit breaker and retry logic
4. **Performance Tests**: Measure latency and throughput

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| DuckDuckGo blocks requests | High | Add fallback engines |
| HTML structure changes | High | Use proper parser (cheerio) |
| API rate limits | Medium | Add rate limiting + caching |
| Increased dependencies | Low | Use minimal, well-maintained packages |

## Conclusion

The current web-search implementation is functional but needs significant improvements for production use. The highest priority is replacing regex parsing with a proper HTML parser and adding search engine redundancy. The recommended architecture (Strategy Pattern + Plugin System) provides flexibility for future expansion.

## Related Research Files

- `web-search-implementation.md` - Detailed code analysis
- `html-parsing-and-best-practices.md` - Industry best practices
