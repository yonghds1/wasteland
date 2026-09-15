# provider 重试错误分类扩容

## Goal

`fetchWithRetry`（`src/providers/shared/retry.ts`，被 `claude.ts` / `openai.ts` 共用）当前只对 429 与 503 重试，
且 `catch` 分支**无条件重试任何异常**。实际后果是两头都不对：

- **该重试的不重试**：500 / 502 / 504、Anthropic 529 `overloaded_error`、以及 socket 类瞬时错误
  （`ECONNRESET` / `ETIMEDOUT` / `socket hang up`）一旦出现即整轮失败，用户看到报错只能自己重发。
- **不该重试的却重试**：`AbortError` 等不可重试异常被退避重试 3 次，白等约 7 秒才抛出真实原因。

本任务把重试判定从「两个状态码 + 一切异常」收敛为一张显式白名单，行为可测、可读。

## Requirements

- **R1 可重试状态白名单**：抽出 `isRetryableStatus(status)`，覆盖 `429 / 500 / 502 / 503 / 504 / 529`
  （529 为 Anthropic overloaded）。白名单外的 4xx（尤其 400 / 401 / 403 / 404）必须**立即返回**，不重试。
- **R2 可重试异常分类：错误码优先**：抽出 `isRetryableError(error)`。取 `error.code`，缺失时取 `error.cause.code`；
  **只要拿到码就以码为准、不再回落到消息特征**——undici 的网络失败一律包成 `TypeError: fetch failed`，真实原因在码上；
  若回落到消息，`ENOTFOUND` 这类永久失败与 `UND_ERR_ABORTED` 这类中止码都会被误放行。
  码白名单只列瞬时项：`ECONNRESET` / `ETIMEDOUT` / `EPIPE` / `EAI_AGAIN` / `ENETUNREACH` / `ECONNREFUSED` /
  `UND_ERR_SOCKET` / `UND_ERR_CONNECT_TIMEOUT` / `UND_ERR_HEADERS_TIMEOUT` / `UND_ERR_BODY_TIMEOUT` /
  `UND_ERR_SOCKET_CLOSED` / `UND_ERR_CLOSED`。
  仅在完全拿不到码时才按消息特征判定：`socket hang up` / `fetch failed` / `Failed to fetch` / `NetworkError`。
  **刻意不按 `error.name === 'TypeError'` 判定**：裸 `TypeError` 可能是编程缺陷，不能因名字放行。
- **R3 中止不重试、且退避期间中止立即生效**：`AbortError`（自身或 `cause` 的 `name === 'AbortError'`）
  或 `options.signal?.aborted` 为真时立即抛出，不进退避；退避等待须与 signal 竞速，不得空耗到退避期满
  （`openai.ts:432` 的 teardown 会在退避中途 `controller.abort()`）。
- **R4 既有语义零回归**：429 仍优先读 `Retry-After`（有则按其秒数等待，无则指数退避）；
  503 仍指数退避；`MAX_RETRIES = 3`、`BASE_RETRY_DELAY = 1000ms`、指数公式 `BASE * 2^(MAX_RETRIES - retries)` 均不变；
  耗尽重试后仍返回最后一个 `Response`（状态白名单分支）或抛出最后一个异常（异常白名单分支）。
- **R5 单测**：新增 `src/providers/shared/__tests__/retry.test.ts`，用 stub 化的 `globalThis.fetch` 覆盖下列断言；
  不引入真实网络与真实等待（`setTimeout` 须 mock 或延迟函数可注入，避免测试跑满退避时长）。

## Acceptance Criteria

- [x] AC1：500 / 502 / 504 / 529 各自触发重试（断言 fetch 调用次数 > 1），最终返回最后一次响应。
- [x] AC2：400 / 401 立即返回且 fetch 只调用 1 次。
- [x] AC3：抛出的 `AbortError` 与 `signal.aborted === true` 场景均**不重试**（fetch 调用次数 === 1，异常原样抛出）。
- [x] AC4：网络类异常（`ECONNRESET` 与 `fetch failed` 各一例）触发重试，次数用尽后抛出最后一个异常。
- [x] AC5：429 带 `Retry-After: 2` 时按其值等待；429 无该头时走指数退避；503 仍重试——三条均断言通过。
- [x] AC6：`npm run check:fast` 绿（exit 0）；`npx vitest run src/providers/shared/__tests__/retry.test.ts` 35 例全绿。
- [x] AC7：`UND_ERR_ABORTED` / `UND_ERR_INVALID_ARG` 不重试；`UND_ERR_SOCKET` / `UND_ERR_CONNECT_TIMEOUT` 重试。
- [x] AC8：cause 显式的 `ENOTFOUND` 与 cause 为 `AbortError` 时均不重试（错误码优先于通用消息，中止码优先于码白名单）。
- [x] AC9：非法 `Retry-After`（HTTP-date 形式）回落指数退避；退避期间 abort 立即抛出 `AbortError` 且不再发起请求。

**红→绿实证**：以上用例对 HEAD 原始实现跑出 28 失败（含 5 个关键新用例全部变红），对新实现 35 全绿。

## Out of Scope

- 重试策略配置化（阈值 / 退避曲线的 settings 暴露）——保持常量现状。
- 各 provider 差异化重试策略（claude 与 openai 继续共用同一实现）。
- SSE 流中途断开的续传 / 断点重连（属另一条链路，非 fetch 建立阶段）。
- 降延迟本身与 UI 层重试提示。
