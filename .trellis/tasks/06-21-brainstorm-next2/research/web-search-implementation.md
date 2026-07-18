# Research: Web-Search Implementation in rx-cli

- **Query**: Research the current web-search implementation in the rx-cli codebase
- **Scope**: Internal (codebase analysis) + External (industry best practices)
- **Date**: 2026-06-21

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src/tools/web-search.ts` | Main web-search tool implementation (333 lines) |
| `src/tools/web-fetch.ts` | Companion web-fetch tool for HTTP requests |
| `src/tools/default-registry.ts` | Tool registry that registers web-search |
| `src/tools/tool-types.ts` | Type definitions for tools |
| `test/tools/git-web-search.test.js` | Test file covering web-search tool |
| `package.json` | Project dependencies (no HTML parser libraries) |

### Code Patterns

#### 1. Search Engine Support

**Current State**: Only DuckDuckGo is supported

```typescript
// Line 35 in web-search.ts
engine: z.enum(['duckduckgo']).default('duckduckgo').describe('搜索引擎（默认 duckduckgo）'),
```

The `engine` parameter is defined as a Zod enum with only one option: `'duckduckgo'`. The code is structured to support additional engines (see `searchDuckDuckGo` function), but no other engines are implemented.

#### 2. HTML Parsing Approach

**Method**: Regex-based parsing (NOT a proper HTML parser)

```typescript
// Lines 163-164 in web-search.ts
const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
```

The implementation uses regular expressions to extract:
- Search result titles and URLs from `<a class="result__a">` elements
- Snippets from `<a class="result__snippet">` elements

**Potential Issues with Regex Approach**:
- Fragile: Breaks if DuckDuckGo changes their HTML structure
- Cannot handle nested HTML or complex attribute orders
- May miss results if HTML format varies
- No error handling for malformed HTML

#### 3. DuckDuckGo Integration Details

**Endpoint Used**: `https://html.duckduckgo.com/html/` (HTML version, not API)

```typescript
// Line 114 in web-search.ts
const searchUrl = new URL('https://html.duckduckgo.com/html/');
```

**URL Redirect Handling**:
```typescript
// Lines 211-225 in web-search.ts
function extractActualUrl(redirectUrl: string): string {
  // DuckDuckGo 重定向格式: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
  if (redirectUrl.includes('duckduckgo.com/l/')) {
    const url = new URL(redirectUrl.startsWith('//') ? `https:${redirectUrl}` : redirectUrl);
    const uddg = url.searchParams.get('uddg');
    if (uddg) {
      return decodeURIComponent(uddg);
    }
  }
  return redirectUrl;
}
```

#### 4. Configuration Constants

```typescript
const DEFAULT_TIMEOUT = 15000;      // 15 seconds
const DEFAULT_MAX_RESULTS = 5;      // Default result count
const MAX_ALLOWED_RESULTS = 20;     // Maximum allowed
const USER_AGENT = 'wasteland/0.1.0 (CLI Tool)';
```

#### 5. Output Format

The tool returns structured data with:
- `query`: Search term
- `engine`: Search engine used
- `results`: Array of `{title, snippet, url}`
- `duration`: Execution time in milliseconds

### TODO Comments / Incomplete Implementations

**No TODO comments found in web-search.ts**

However, the code structure suggests planned extensibility:
- The `engine` parameter is designed to accept multiple values (currently only `'duckduckgo'`)
- The `searchDuckDuckGo` function is isolated, suggesting other engine functions could be added
- The `formatResults` function accepts an `engine` parameter for display

### Test Coverage

Tests are in `test/tools/git-web-search.test.js`:

| Test Case | Status |
|-----------|--------|
| Module import | Implemented |
| Tool instance creation | Implemented |
| Missing query parameter | Implemented |
| Empty query parameter | Implemented |
| Unsupported search engine (google) | Implemented |
| Default duckduckgo engine | Implemented |
| Max results limit (100 -> 20) | Implemented |

**Note**: Network-dependent tests are wrapped in try/catch to handle offline environments.

### External References

**Industry Best Practices for Web Search in AI Agents**:

1. **API vs HTML Scraping**:
   - DuckDuckGo's official API (Instant Answer API) is limited
   - HTML scraping (current approach) is common but fragile
   - Consider dedicated search APIs (Google Custom Search, Bing, Brave Search API)

2. **HTML Parsing Libraries**:
   - `cheerio`: Fast, jQuery-like API for server-side HTML parsing
   - `jsdom`: Full DOM implementation for Node.js
   - `parse5`: HTML5 compliant parser
   - Current regex approach is less reliable than these libraries

3. **Search Engine Options for AI Agents**:
   - DuckDuckGo: Free, no API key required, but limited
   - Brave Search API: Paid, good privacy focus
   - Google Custom Search: Requires API key, rate limits
   - Bing Search API: Paid, good for enterprise
   - SearXNG: Self-hosted meta-search engine

4. **Rate Limiting and Reliability**:
   - Current implementation has no retry logic
   - No rate limiting protection
   - Single point of failure (DuckDuckGo only)

### Related Specs

- `.trellis/spec/guides/code-reuse-thinking-guide.md` - Code reuse patterns (relevant for adding new search engines)

## Caveats / Not Found

1. **No external HTML parser library**: The project does not use cheerio, jsdom, or similar libraries for HTML parsing. The regex approach is self-contained but fragile.

2. **No DuckDuckGo API key**: The implementation uses the free HTML endpoint, which may have rate limits or be blocked by DuckDuckGo.

3. **No error handling for HTML structure changes**: If DuckDuckGo changes their HTML class names (e.g., `result__a`), the parser will silently return empty results.

4. **No fallback mechanism**: If DuckDuckGo is unavailable, there's no fallback to another search engine.

5. **No caching**: Results are not cached, so repeated searches for the same query make multiple network requests.

6. **No search region/language support**: The current implementation doesn't support region-specific or language-specific searches.

7. **User-Agent is minimal**: The current User-Agent (`wasteland/0.1.0 (CLI Tool)`) may be blocked by some services.

## Priority Order for Improvements (Based on Research)

**High Priority**:
1. Add proper HTML parser (cheerio) to replace regex-based parsing
2. Add fallback search engine (e.g., Brave Search API)
3. Improve error handling for DuckDuckGo HTML structure changes

**Medium Priority**:
4. Add retry logic with exponential backoff
5. Add result caching for repeated queries
6. Support additional search engines (Google, Bing)

**Low Priority**:
7. Add search region/language support
8. Improve User-Agent to avoid blocking
9. Add rate limiting protection
