/**
 * retry.ts - Provider 共享的重试与解析工具
 *
 * 抽取自 claude.ts / openai.ts，消除 fetchWithRetry / parseToolArguments 的重复定义。
 */

/** 最大重试次数 */
const MAX_RETRIES = 3;

/** 基础重试延迟（毫秒） */
const BASE_RETRY_DELAY = 1000;

/**
 * 带重试的 fetch 请求
 *
 * 429 / 503 / 网络错误时按指数退避重试。
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

    // 429 Rate Limit - 等待 Retry-After 或指数退避
    if (response.status === 429) {
      if (retries > 0) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : BASE_RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return fetchWithRetry(url, options, retries - 1);
      }
    }

    // 503 Service Unavailable - 指数退避重试
    if (response.status === 503 && retries > 0) {
      const delay = BASE_RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1);
    }

    return response;
  } catch (error) {
    // 网络错误 - 指数退避重试
    if (retries > 0) {
      const delay = BASE_RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
      await new Promise((resolve) => setTimeout(resolve, delay));
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
