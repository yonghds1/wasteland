/**
 * retry.ts - Provider 共享的重试与解析工具
 *
 * 抽取自 claude.ts / openai.ts，消除 fetchWithRetry / parseToolArguments 的重复定义。
 */

/** 最大重试次数 */
const MAX_RETRIES = 3;

/** 基础重试延迟（毫秒） */
const BASE_RETRY_DELAY = 1000;

/** 服务端瞬时故障：限流、网关抖动、Anthropic overloaded（529） */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

/** 网络瞬时故障的错误码；ENOTFOUND 等永久失败与 UND_ERR_ABORTED 等中止码刻意不在列 */
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ECONNREFUSED',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET_CLOSED',
  'UND_ERR_CLOSED',
]);

/** 拿不到错误码时的消息特征 */
const RETRYABLE_MESSAGES = ['socket hang up', 'fetch failed', 'Failed to fetch', 'NetworkError'];

/** 该状态是否为服务端瞬时故障 */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

/**
 * 该异常是否为可重试的网络瞬时故障（中止不算）。
 *
 * 有错误码时**以码为准、不再回落到消息特征**：undici 的网络失败统一包成
 * `TypeError: fetch failed`，真实原因在 `code` / `cause.code` 上；若回落到消息，
 * 就会把 ENOTFOUND 这类永久失败与 UND_ERR_ABORTED 一并放行。
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const cause = (error as { cause?: unknown }).cause;
  if (isAbortError(error) || isAbortError(cause)) return false;

  const code = readErrorCode(error) ?? readErrorCode(cause);
  if (code) return RETRYABLE_CODES.has(code);

  return (
    matchesMessage(error.message) ||
    (cause instanceof Error && matchesMessage(cause.message))
  );
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === 'AbortError';
}

function readErrorCode(value: unknown): string | null {
  if (!(value instanceof Error)) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function matchesMessage(message: string): boolean {
  return RETRYABLE_MESSAGES.some((pattern) => message.includes(pattern));
}

/** 429 优先遵从 Retry-After，其余按剩余次数指数退避 */
function retryDelayMs(status: number, headers: Headers, retries: number): number {
  if (status === 429) {
    const retryAfter = headers.get('Retry-After');
    if (retryAfter) {
      const seconds = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    }
  }
  return BASE_RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
}

/** 退避等待；signal 中止时立即结束等待，不再空耗到退避期满 */
function delay(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortedError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * 带重试的 fetch 请求
 *
 * 仅对服务端瞬时故障（429/5xx/529）与网络瞬时故障按指数退避重试；
 * 中止（AbortError / signal 已 abort）与其余 4xx 立即返回或抛出。
 *
 * @param url - 请求 URL
 * @param options - fetch 选项
 * @param retries - 剩余重试次数
 * @returns Response 对象
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = MAX_RETRIES
): Promise<Response> {
  try {
    const response = await fetch(url, options);

    if (isRetryableStatus(response.status) && retries > 0) {
      await delay(retryDelayMs(response.status, response.headers, retries), options.signal);
      if (options.signal?.aborted) throw abortedError();
      return fetchWithRetry(url, options, retries - 1);
    }

    return response;
  } catch (error) {
    if (isRetryableError(error) && !options.signal?.aborted && retries > 0) {
      await delay(BASE_RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries), options.signal);
      if (options.signal?.aborted) throw abortedError();
      return fetchWithRetry(url, options, retries - 1);
    }

    throw error;
  }
}

/**
 * 解析工具调用参数 JSON，失败时返回空对象
 */
export function parseToolArguments(argsJson: string): Record<string, unknown> {
  if (!argsJson) return {};
  try {
    return JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}
