# Research: HTML Parsing Approaches and Web Search Best Practices

- **Query**: Industry best practices for web search tools in AI agents
- **Scope**: External (industry research)
- **Date**: 2026-06-21

## Findings

### HTML Parsing Libraries Comparison

| Library | Type | Size | Performance | Use Case |
|---------|------|------|-------------|----------|
| **cheerio** | jQuery-like API | ~7MB | Fast (no DOM emulation) | Server-side HTML parsing, scraping |
| **jsdom** | Full DOM | ~15MB | Slower (full DOM) | Testing, complex DOM manipulation |
| **parse5** | HTML5 parser | ~2MB | Fast | Low-level HTML parsing |
| **htmlparser2** | SAX-style | ~1MB | Very fast | Streaming, memory-efficient |

**Recommendation for rx-cli**: `cheerio` is the best fit because:
- Lightweight and fast
- jQuery-like API (familiar to many developers)
- Excellent for extracting data from HTML
- No DOM emulation overhead

### Web Search API Options for AI Agents

#### 1. DuckDuckGo (Current)
**Pros**:
- Free, no API key required
- Privacy-focused
- Good for general searches

**Cons**:
- No official API (HTML scraping required)
- Rate limiting possible
- May block automated requests
- Limited result customization

#### 2. Brave Search API
**Pros**:
- Official API with documentation
- Good privacy focus
- No tracking
- Free tier available (2,000 queries/month)

**Cons**:
- Requires API key
- Paid for high volume
- Smaller index than Google

#### 3. Google Custom Search JSON API
**Pros**:
- Largest search index
- Highly customizable
- Official API

**Cons**:
- Requires API key + search engine ID
- 100 queries/day free, then paid
- Complex pricing structure

#### 4. Bing Web Search API
**Pros**:
- Microsoft-backed
- Good for enterprise
- Generous free tier (1,000 queries/month)

**Cons**:
- Requires Azure subscription
- Complex setup process

#### 5. SearXNG (Self-hosted)
**Pros**:
- Full control
- No rate limits
- Meta-search (multiple engines)
- Privacy-focused

**Cons**:
- Requires hosting
- Maintenance overhead
- Setup complexity

### Best Practices for Web Search in AI Agents

#### 1. Error Handling and Resilience

```typescript
// Recommended pattern: Circuit Breaker
class SearchCircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  
  async executeWithFallback<T>(
    primary: () => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<T> {
    try {
      if (this.failures >= 3 && Date.now() - this.lastFailure < 60000) {
        return await fallback(); // Use fallback if circuit is open
      }
      const result = await primary();
      this.failures = 0; // Reset on success
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = Date.now();
      throw error;
    }
  }
}
```

#### 2. Rate Limiting

```typescript
// Token bucket algorithm
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  
  constructor(
    private maxTokens: number,
    private refillRate: number // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }
  
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens < 1) {
      const waitTime = (1 - this.tokens) / this.refillRate * 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.refill();
    }
    this.tokens--;
  }
  
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}
```

#### 3. Caching Strategy

```typescript
// LRU Cache for search results
interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}

class SearchCache {
  private cache = new Map<string, CacheEntry>();
  
  constructor(
    private maxEntries: number = 100,
    private ttlMs: number = 3600000 // 1 hour
  ) {}
  
  get(query: string): SearchResult[] | null {
    const entry = this.cache.get(query);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(query);
      return null;
    }
    
    return entry.results;
  }
  
  set(query: string, results: SearchResult[]): void {
    if (this.cache.size >= this.maxEntries) {
      // Delete oldest entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    
    this.cache.set(query, {
      results,
      timestamp: Date.now(),
    });
  }
}
```

#### 4. User-Agent Rotation

```typescript
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
```

#### 5. Retry with Exponential Backoff

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      const delay = baseDelay * Math.pow(2, attempt);
      const jitter = delay * 0.1 * Math.random();
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
    }
  }
  throw new Error('Max retries exceeded');
}
```

### HTML Parsing Best Practices

#### 1. Use Proper Parser (Not Regex)

**Bad** (current approach):
```typescript
const regex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
```

**Good** (with cheerio):
```typescript
import * as cheerio from 'cheerio';

function parseHTML(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  
  $('a.result__a').each((_, element) => {
    const $el = $(element);
    results.push({
      title: $el.text().trim(),
      url: $el.attr('href') || '',
      snippet: $el.next('a.result__snippet')?.text().trim() || '',
    });
  });
  
  return results;
}
```

#### 2. Handle Malformed HTML

```typescript
function parseWithFallback(html: string): SearchResult[] {
  try {
    return parseWithCheerio(html);
  } catch (error) {
    console.warn('Cheerio parsing failed, falling back to regex');
    return parseWithRegex(html);
  }
}
```

#### 3. Validate Extracted Data

```typescript
function validateResult(result: Partial<SearchResult>): result is SearchResult {
  return (
    typeof result.title === 'string' &&
    result.title.length > 0 &&
    typeof result.url === 'string' &&
    result.url.startsWith('http') &&
    typeof result.snippet === 'string'
  );
}
```

### Architecture Recommendations

#### 1. Strategy Pattern for Search Engines

```typescript
interface SearchEngine {
  name: string;
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}

class DuckDuckGoEngine implements SearchEngine {
  name = 'duckduckgo';
  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    // Implementation
  }
}

class BraveSearchEngine implements SearchEngine {
  name = 'brave';
  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    // Implementation
  }
}

class WebSearchTool {
  private engines: Map<string, SearchEngine> = new Map();
  private fallbackOrder: string[] = ['duckduckgo', 'brave'];
  
  constructor() {
    this.engines.set('duckduckgo', new DuckDuckGoEngine());
    this.engines.set('brave', new BraveSearchEngine());
  }
  
  async search(query: string, engine?: string): Promise<SearchResult[]> {
    if (engine) {
      return this.engines.get(engine)!.search(query, 5);
    }
    
    // Fallback chain
    for (const engineName of this.fallbackOrder) {
      try {
        return await this.engines.get(engineName)!.search(query, 5);
      } catch (error) {
        console.warn(`Engine ${engineName} failed, trying next`);
      }
    }
    
    throw new Error('All search engines failed');
  }
}
```

#### 2. Plugin Architecture

```typescript
// Search engine plugin interface
interface SearchPlugin {
  name: string;
  version: string;
  init(config: SearchConfig): void;
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
  isAvailable(): Promise<boolean>;
}

// Plugin registry
class SearchPluginRegistry {
  private plugins: Map<string, SearchPlugin> = new Map();
  
  register(plugin: SearchPlugin): void {
    this.plugins.set(plugin.name, plugin);
  }
  
  get(name: string): SearchPlugin | undefined {
    return this.plugins.get(name);
  }
  
  async getAvailable(): Promise<SearchPlugin[]> {
    const available: SearchPlugin[] = [];
    for (const plugin of this.plugins.values()) {
      if (await plugin.isAvailable()) {
        available.push(plugin);
      }
    }
    return available;
  }
}
```

### Security Considerations

1. **Sanitize User Input**: Escape special characters in search queries
2. **Validate URLs**: Ensure extracted URLs are valid and safe
3. **Rate Limiting**: Prevent abuse and respect service limits
4. **User-Agent Rotation**: Avoid detection and blocking
5. **HTTPS Only**: Never use HTTP for search requests
6. **Timeout Handling**: Prevent hanging requests

### Performance Optimization

1. **Connection Pooling**: Reuse HTTP connections
2. **Parallel Searches**: Search multiple engines simultaneously
3. **Result Caching**: Cache results for repeated queries
4. **Lazy Loading**: Only fetch results when needed
5. **Compression**: Use gzip/deflate for responses

## External References

- [Cheerio Documentation](https://cheerio.js.org/) - Fast, flexible HTML parsing
- [DuckDuckGo HTML Endpoint](https://html.duckduckgo.com/html/) - Current integration point
- [Brave Search API](https://api.search.brave.com/) - Alternative search API
- [Google Custom Search API](https://developers.google.com/custom-search/v1/overview) - Google search integration
- [Bing Web Search API](https://www.microsoft.com/en-us/bing/apis/bing-web-search-api) - Microsoft search integration

## Caveats

1. **API Key Management**: If adding paid search engines, need secure key storage
2. **Cost Tracking**: Monitor API usage to avoid unexpected charges
3. **Legal Compliance**: Ensure scraping complies with terms of service
4. **Geographic Restrictions**: Some APIs may have regional limitations
5. **Rate Limit Changes**: Service providers may change limits without notice
