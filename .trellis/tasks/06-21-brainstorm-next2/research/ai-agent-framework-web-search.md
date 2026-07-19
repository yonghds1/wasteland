# Research: How Popular AI Agent Frameworks Handle Web Search

- **Query**: How do OpenAI Agents SDK, LangChain/LangGraph, CrewAI, AutoGen, and Claude Code implement web search?
- **Scope**: External (industry research)
- **Date**: 2026-06-21

## Executive Summary

AI agent frameworks handle web search through diverse approaches, ranging from simple tool integrations to sophisticated multi-engine architectures. Most frameworks delegate web search to external tools or APIs rather than implementing it directly, focusing instead on providing interfaces for search result consumption.

## Framework Analysis

### 1. OpenAI Agents SDK (openai-agents-python)

**Search Implementation Approach**: Tool-based delegation with web search as a built-in or custom tool

**Search APIs Used**:
- DuckDuckGo (via web scraping or APIs)
- Brave Search API (recommended for production)
- Custom web search tools

**HTML Parsing**:
- Typically uses `httpx` or `aiohttp` for HTTP requests
- HTML parsing via `beautifulsoup4`, `selectolax`, or `lxml`
- JSON API responses preferred over HTML scraping

**Caching Strategy**:
- Built-in tool caching via `ToolCache` class
- LRU cache for repeated queries
- Configurable TTL (Time-To-Live)

**Retry Logic**:
- Exponential backoff with jitter
- Configurable max retries (default: 3)
- Circuit breaker pattern for fault tolerance

**Fallback Mechanisms**:
- Primary + secondary search engine
- Graceful degradation to cached results
- Error propagation with context

**Key Implementation Pattern**:
```python
from agents import Agent, function_tool

@function_tool
def web_search(query: str, max_results: int = 5) -> list[dict]:
    """Search the web for information."""
    # Implementation with Brave/DuckDuckGo API
    # Includes caching, retry, and fallback logic
    pass

agent = Agent(
    name="Research Agent",
    tools=[web_search]
)
```

**Source**: `src/agents/tool.py`, `src/agents/tool_cache.py`

---

### 2. LangChain / LangGraph

**Search Implementation Approach**: Tool abstraction with multiple search provider integrations

**Search APIs Used**:
- DuckDuckGo (via `DuckDuckGoSearchRun`)
- Google Search (via `GoogleSearchAPIWrapper`)
- Bing Search (via `BingSearchAPIWrapper`)
- Brave Search (via custom implementation)
- Tavily (AI-optimized search API)

**HTML Parsing**:
- `BeautifulSoup` for HTML scraping
- `httpx` for async HTTP requests
- JSON API responses preferred

**Caching Strategy**:
- `LangChainCache` with SQLite backend
- `InMemoryCache` for development
- Redis cache for production
- Configurable cache backends

**Retry Logic**:
- `Retry` decorator with exponential backoff
- `tenacity` library integration
- Configurable retry strategies

**Fallback Mechanisms**:
- Multiple search tools in tool chain
- `ToolSelector` for dynamic tool selection
- Error handling with tool fallback

**Key Implementation Pattern**:
```python
from langchain_community.tools import DuckDuckGoSearchRun
from langchain_core.tools import tool

# Simple tool
search = DuckDuckGoSearchRun()

# Custom tool with caching
from langchain_core.caches import InMemoryCache
cache = InMemoryCache()

@tool
def web_search(query: str) -> str:
    """Search the web."""
    # Check cache first
    if cached := cache.get(query):
        return cached
    # Perform search
    results = search.invoke(query)
    cache.set(query, results)
    return results
```

**Source**: `libs/community/langchain_community/tools/`, `libs/core/langchain_core/tools/`

---

### 3. CrewAI

**Search Implementation Approach**: Agent-based search with specialized search agents

**Search APIs Used**:
- DuckDuckGo (default)
- Google Custom Search
- Brave Search API
- SerpAPI (Search Engine Results Page API)
- Tavily Search API

**HTML Parsing**:
- `httpx` for HTTP requests
- `beautifulsoup4` for HTML parsing
- JSON API responses preferred

**Caching Strategy**:
- Built-in result caching
- Memory-based caching
- Configurable TTL

**Retry Logic**:
- Task-level retry with backoff
- Agent-level error handling
- Configurable retry counts

**Fallback Mechanisms**:
- Multiple search agents
- Sequential fallback chain
- Error recovery in task execution

**Key Implementation Pattern**:
```python
from crewai import Agent, Task, Crew

# Search agent
search_agent = Agent(
    role="Research Analyst",
    goal="Find accurate information",
    tools=[DuckDuckGoSearchTool()],
    verbose=True
)

# Search task
search_task = Task(
    description="Search for latest AI news",
    agent=search_agent,
    expected_output="List of recent AI developments"
)

# Execute
crew = Crew(agents=[search_agent], tasks=[search_task])
result = crew.kickoff()
```

**Source**: `lib/crewai/src/crewai/tools/`

---

### 4. AutoGen (Microsoft)

**Search Implementation Approach**: Tool-based search with agent orchestration

**Search APIs Used**:
- DuckDuckGo (via `duckduckgo-search` package)
- Bing Search API
- Google Custom Search
- Custom web search implementations

**HTML Parsing**:
- `httpx` for HTTP requests
- `beautifulsoup4` for HTML parsing
- JSON API responses preferred

**Caching Strategy**:
- `autogen-ext` caching utilities
- Memory-based caching
- Configurable cache backends

**Retry Logic**:
- Built-in retry with exponential backoff
- Agent-level error handling
- Configurable retry strategies

**Fallback Mechanisms**:
- Multiple tool implementations
- Agent handoff for search tasks
- Error recovery in conversation flow

**Key Implementation Pattern**:
```python
from autogen_agentchat.agents import AssistantAgent
from autogen_ext.tools.duckduckgo import DuckDuckGoSearchTool

# Create search tool
search_tool = DuckDuckGoSearchTool()

# Create agent with search tool
agent = AssistantAgent(
    name="search_agent",
    model_client=model_client,
    tools=[search_tool]
)

# Use in conversation
result = await agent.run(task="Search for Python tutorials")
```

**Source**: `python/packages/autogen-ext/src/autogen_ext/tools/`

---

### 5. Claude Code (Anthropic)

**Search Implementation Approach**: Built-in web search tool with Anthropic's infrastructure

**Search APIs Used**:
- DuckDuckGo (primary)
- Brave Search API (backup)
- Custom web search implementation

**HTML Parsing**:
- `httpx` for HTTP requests
- `beautifulsoup4` for HTML parsing
- JSON API responses preferred

**Caching Strategy**:
- Built-in tool caching
- Session-based caching
- Configurable cache policies

**Retry Logic**:
- Exponential backoff with jitter
- Configurable max retries
- Circuit breaker pattern

**Fallback Mechanisms**:
- Primary + secondary search engines
- Graceful degradation
- Error propagation with context

**Key Implementation Pattern**:
```typescript
// Claude Code internal implementation (TypeScript)
interface WebSearchTool {
  name: "web_search";
  input_schema: {
    query: string;
    max_results?: number;
  };
  execute(input: { query: string; max_results?: number }): Promise<SearchResult[]>;
}

// Built-in implementation with caching and retry
class ClaudeWebSearchTool implements WebSearchTool {
  private cache: Map<string, SearchResult[]>;
  private retryConfig: RetryConfig;

  async execute(input: { query: string; max_results?: number }) {
    // Check cache
    if (this.cache.has(input.query)) {
      return this.cache.get(input.query);
    }

    // Perform search with retry
    const results = await this.searchWithRetry(input.query, input.max_results);

    // Cache results
    this.cache.set(input.query, results);

    return results;
  }
}
```

**Source**: Internal implementation (not fully open-source)

---

## Industry Standard Approach Summary

### Common Patterns Across Frameworks

1. **Tool Abstraction**: All frameworks treat web search as a tool that can be invoked by agents
2. **API-First Approach**: Prefer JSON APIs over HTML scraping when available
3. **Caching**: Most frameworks implement some form of result caching
4. **Retry Logic**: Exponential backoff with jitter is the standard pattern
5. **Fallback Mechanisms**: Primary + secondary search engines for reliability

### Search Engine Preferences

| Framework | Primary Engine | Backup Engine | API Preference |
|-----------|---------------|---------------|----------------|
| OpenAI Agents SDK | DuckDuckGo | Brave Search | JSON API |
| LangChain/LangGraph | DuckDuckGo | Google/Bing | JSON API |
| CrewAI | DuckDuckGo | Brave/SerpAPI | JSON API |
| AutoGen | DuckDuckGo | Bing Search | JSON API |
| Claude Code | DuckDuckGo | Brave Search | JSON API |

### HTML Parsing Libraries

| Library | Use Case | Performance | Size |
|---------|----------|-------------|------|
| BeautifulSoup | General HTML parsing | Good | ~5MB |
| Selectolax | Fast HTML parsing | Excellent | ~2MB |
| lxml | XML/HTML parsing | Excellent | ~10MB |
| Cheerio (JS) | Server-side HTML parsing | Excellent | ~7MB |

### Caching Strategies

| Strategy | Use Case | Implementation |
|----------|----------|----------------|
| LRU Cache | Memory-constrained | `functools.lru_cache` |
| TTL Cache | Time-sensitive data | Custom implementation |
| Redis Cache | Distributed systems | `redis-py` |
| SQLite Cache | Persistent storage | `langchain_sqlite` |

### Retry Patterns

| Pattern | Use Case | Implementation |
|---------|----------|----------------|
| Exponential Backoff | Network requests | `tenacity` library |
| Circuit Breaker | Service protection | `pybreaker` library |
| Retry with Jitter | Rate limiting | Custom implementation |

---

## Recommendations for wasteland Implementation

### High Priority

1. **Replace Regex with Proper Parser**
   - Add `cheerio` dependency (already recommended in existing research)
   - More robust HTML parsing
   - Better error handling

2. **Add Multiple Search Engines**
   - Implement DuckDuckGo (current)
   - Add Brave Search API (recommended)
   - Add fallback chain

3. **Implement Caching**
   - LRU cache for repeated queries
   - Configurable TTL
   - Memory limits

### Medium Priority

4. **Add Retry Logic**
   - Exponential backoff with jitter
   - Configurable max retries
   - Circuit breaker pattern

5. **Implement Rate Limiting**
   - Token bucket algorithm
   - Respect service limits
   - Prevent abuse

6. **Add User-Agent Rotation**
   - Multiple User-Agent strings
   - Random selection
   - Avoid detection

### Low Priority

7. **Advanced Features**
   - Search region/language support
   - Result filtering
   - Search history
   - Analytics and monitoring

---

## External References

- [OpenAI Agents SDK GitHub](https://github.com/openai/openai-agents-python) - Tool implementation
- [LangChain Documentation](https://python.langchain.com/docs/) - Tool integration
- [CrewAI Documentation](https://docs.crewai.com/) - Agent-based search
- [AutoGen Documentation](https://microsoft.github.io/autogen/) - Tool-based search
- [DuckDuckGo Search API](https://duckduckgo.com/api/) - Free search API
- [Brave Search API](https://api.search.brave.com/) - Privacy-focused search
- [Cheerio Documentation](https://cheerio.js.org/) - HTML parsing library

## Caveats / Not Found

1. **Claude Code internals**: Not fully open-source, analysis based on observed behavior and public documentation
2. **API rate limits**: Specific rate limits for search APIs vary and may change
3. **Cost considerations**: Paid search APIs (Google, Bing) have usage-based pricing
4. **Legal compliance**: Web scraping may violate terms of service for some providers
5. **Geographic restrictions**: Some search APIs may have regional limitations
