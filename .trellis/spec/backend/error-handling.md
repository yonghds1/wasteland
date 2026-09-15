# Error Handling

> Current status / 当前状态: provider HTTP 重试分类契约已确立（2026-09-15）。其余错误处理约定仍未建立。

---

## Established: Provider HTTP 重试分类契约

### 1. Scope / Trigger

- **Trigger**: 任何改动 `src/providers/shared/retry.ts` 的行为，或新增 provider 接入 `fetchWithRetry`。
- 该模块是 `claude.ts` / `openai.ts` 共用的 fetch 建立阶段唯一入口；它决定「什么错误值得重试」，
  直接决定用户看到的是自愈还是报错。

### 2. Signatures

```ts
export function isRetryableStatus(status: number): boolean
export function isRetryableError(error: unknown): boolean
export function fetchWithRetry(url: string, options: RequestInit, retries?: number): Promise<Response>
```

常量：`MAX_RETRIES = 3`、`BASE_RETRY_DELAY = 1000`；退避公式 `BASE_RETRY_DELAY * 2 ** (MAX_RETRIES - retries)`。

### 3. Contracts

- **状态白名单**：`429 / 500 / 502 / 503 / 504 / 529`（529 = Anthropic overloaded）→ 重试。
  其余状态（含全部 4xx）→ 立即返回 `Response`，由调用方的 `!response.ok` 分支处理错误体。
- **429 退避**：优先读 `Retry-After`（秒）；非数值（如 HTTP-date）或缺失时回落指数退避。
- **异常分类：错误码优先**。取 `error.code`，缺失时取 `error.cause.code`。
  **一旦拿到码就以码为准，不再回落到消息特征**——undici 的网络失败一律包成 `TypeError: fetch failed`，
  真实原因在码上；回落会让 `ENOTFOUND` 这类永久失败被误放行。
  码白名单只列瞬时项：`ECONNRESET` / `ETIMEDOUT` / `EPIPE` / `EAI_AGAIN` / `ENETUNREACH` / `ECONNREFUSED` /
  `UND_ERR_SOCKET` / `UND_ERR_CONNECT_TIMEOUT` / `UND_ERR_HEADERS_TIMEOUT` / `UND_ERR_BODY_TIMEOUT` /
  `UND_ERR_SOCKET_CLOSED` / `UND_ERR_CLOSED`。
- **仅在完全拿不到码时**才按消息特征判定：`socket hang up` / `fetch failed` / `Failed to fetch` / `NetworkError`。
- **中止**：`error.name === 'AbortError'`（自身或其 `cause`）或 `options.signal?.aborted` →
  立即抛出，不进退避；退避等待与 signal 竞速，中止时立即结束等待并抛 `AbortError`。
- **不按 `error.name === 'TypeError'` 判定**：裸 `TypeError` 可能是编程缺陷，不能因名字放行。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| 429 / 500 / 502 / 503 / 504 / 529，`retries > 0` | 退避后重试 |
| 上述状态，`retries === 0` | 返回该 `Response`（不抛错） |
| 400 / 401 / 403 / 404 / 422 | 立即返回，不重试 |
| 错误码在瞬时白名单内且 `retries > 0` | 退避后重试 |
| 错误码存在但不在白名单（含 `ENOTFOUND`、`UND_ERR_ABORTED`） | 立即抛出，不重试 |
| 无错误码，消息含瞬时特征且 `retries > 0` | 退避后重试 |
| `AbortError`（自身或 cause）/ `signal.aborted` | 立即抛出，不重试 |
| 退避等待期间 `signal` 中止 | 立即结束等待并抛 `AbortError`，**不再发起请求** |
| 重试耗尽仍为异常 | 抛出最后一次的异常对象（原样，不包装） |

### 5. Good/Base/Bad Cases

- **Good**：上游网关抖动返回 502 → 退避后重试成功，用户无感。
- **Base**：401 无效 key → 立即返回，调用方读 error body 报出可读信息。
- **Bad**：用消息特征兜底盖过错误码 → `fetch failed` 命中，`ENOTFOUND` 被重试 3 次，
  用户多等约 7 秒才看到「域名解析失败」。

### 6. Tests Required

`src/providers/shared/__tests__/retry.test.ts`（fake timers 驱动退避，禁止真实等待）。断言点：

- 各可重试状态重试、各 4xx 不重试（断言 `fetch` 调用次数）
- `AbortError` 与 `signal.aborted` 不重试；退避期间 abort 不发起第二次请求
- 瞬时码重试、非瞬时码（`UND_ERR_ABORTED` / `UND_ERR_INVALID_ARG`）不重试
- cause 显式给出 `ENOTFOUND` 或为 `AbortError` 时不重试
- 429 按 `Retry-After` 精确等待；非数值 `Retry-After` 回落指数退避
- 重试耗尽后返回最后 `Response` / 抛出最后原始异常对象（`toBe` 同一对象，非 `toBeInstanceOf`）

### 7. Wrong vs Correct

#### Wrong —— 消息特征优先，错误码形同虚设

```ts
if (matchesPattern(error.message)) return true;   // 'fetch failed' 恒命中 → 提前 return
const cause = (error as { cause?: unknown }).cause;
if (cause instanceof Error && cause.name === 'AbortError') return false;  // 死代码，永不执行
```

undici 的失败几乎总是 `TypeError: fetch failed`，于是 `cause` 里的 `AbortError` 排除与真实错误码
（`ENOTFOUND`、`UND_ERR_ABORTED`）全部走不到。

#### Correct —— 先排除中止，再让错误码作权威

```ts
const cause = (error as { cause?: unknown }).cause;
if (isAbortError(error) || isAbortError(cause)) return false;

const code = readErrorCode(error) ?? readErrorCode(cause);
if (code) return RETRYABLE_CODES.has(code);       // 有码即定论

return matchesMessage(error.message) || (cause instanceof Error && matchesMessage(cause.message));
```

---

## Still Unestablished / 仍未建立

以下错误处理约定在本仓库中尚无定论，不要在 spec 里先行规定：

- 自定义错误类型或错误类
- 模块间的错误传播边界（`subscriber.error` 之外的统一约定）
- 面向用户的错误文案格式

---

## Future Update Checklist / 后续补充清单

- [x] external boundaries（provider HTTP 建立阶段）—— 见上方契约
- [ ] custom error types or classes
- [ ] propagation boundaries between modules
- [ ] logging expectations for failures
- [ ] client-facing / API error response format
- [ ] 2-3 representative examples from real code
