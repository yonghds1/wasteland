import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry, isRetryableStatus, isRetryableError } from '../retry.js';

function makeResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

/** 在 fake timers 下驱动重试的退避等待，并捕获最终结果 */
async function settle<T>(promise: Promise<T>): Promise<T | unknown> {
  const captured = promise.catch((error: unknown) => error);
  await vi.runAllTimersAsync();
  return captured;
}

describe('isRetryableStatus', () => {
  it.each([429, 500, 502, 503, 504, 529])('treats %i as retryable', (status) => {
    expect(isRetryableStatus(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('treats %i as not retryable', (status) => {
    expect(isRetryableStatus(status)).toBe(false);
  });
});

describe('isRetryableError', () => {
  it('rejects AbortError', () => {
    const error = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(isRetryableError(error)).toBe(false);
  });

  it('accepts network error codes on the error itself', () => {
    expect(isRetryableError(Object.assign(new Error('boom'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryableError(Object.assign(new Error('boom'), { code: 'ETIMEDOUT' }))).toBe(true);
  });

  it('accepts messages matching network patterns', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableError(new Error('socket hang up'))).toBe(true);
  });

  it('accepts causes carrying the real network failure', () => {
    const error = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    });
    expect(isRetryableError(error)).toBe(true);
  });

  it('rejects aborted causes even when the message looks retryable', () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }),
    });
    expect(isRetryableError(error)).toBe(false);
  });

  it('rejects non-transient undici codes', () => {
    expect(isRetryableError(Object.assign(new Error('boom'), { code: 'UND_ERR_ABORTED' }))).toBe(
      false
    );
    expect(isRetryableError(Object.assign(new Error('boom'), { code: 'UND_ERR_INVALID_ARG' }))).toBe(
      false
    );
  });

  it('treats an explicit code as authoritative over the generic "fetch failed" message', () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.example.test'), {
        code: 'ENOTFOUND',
      }),
    });
    expect(isRetryableError(error)).toBe(false);
  });

  it('accepts transient undici codes', () => {
    expect(isRetryableError(Object.assign(new Error('boom'), { code: 'UND_ERR_SOCKET' }))).toBe(
      true
    );
    expect(
      isRetryableError(Object.assign(new Error('boom'), { code: 'UND_ERR_CONNECT_TIMEOUT' }))
    ).toBe(true);
  });

  it('rejects non-Error values and unrelated errors', () => {
    expect(isRetryableError('nope')).toBe(false);
    expect(isRetryableError(new Error('invalid api key'))).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([500, 502, 504, 529])('retries on %i and returns the recovered response', async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(status))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(fetchWithRetry('https://example.test', {}, 1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((result as Response).status).toBe(200);
  });

  it.each([400, 401])('returns %i immediately without retrying', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(status));
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(fetchWithRetry('https://example.test', {}, 3));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((result as Response).status).toBe(status);
  });

  it('does not retry AbortError', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(fetchWithRetry('https://example.test', {}, 3));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(abortError);
  });

  it('does not retry when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchError = new Error('fetch failed');
    const fetchMock = vi.fn().mockRejectedValue(fetchError);
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(
      fetchWithRetry('https://example.test', { signal: controller.signal }, 3)
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 必须是原样抛出的 fetch 错误，而非任何 Error（否则实现抛错也能通过）
    expect(result).toBe(fetchError);
  });

  it('retries network errors and throws the last one once retries are exhausted', async () => {
    const networkError = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const fetchMock = vi.fn().mockRejectedValue(networkError);
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(fetchWithRetry('https://example.test', {}, 2));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toBe(networkError);
  });

  it('retries a bare "fetch failed" error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(fetchWithRetry('https://example.test', {}, 1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((result as Response).status).toBe(200);
  });

  it('waits exactly Retry-After seconds on 429', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchWithRetry('https://example.test', {}, 1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(200);
  });

  it('falls back to exponential backoff on 429 without Retry-After', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchWithRetry('https://example.test', {}, 1);

    // retries=1 => BASE_RETRY_DELAY * 2^(MAX_RETRIES - retries) = 1000 * 2^2 = 4000ms
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(200);
  });

  it('falls back to exponential backoff when Retry-After is not a number', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, { 'Retry-After': 'Wed, 21 Oct 2015 07:28:00 GMT' }))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchWithRetry('https://example.test', {}, 1);

    await vi.advanceTimersByTimeAsync(3999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(200);
  });

  it('stops waiting and throws AbortError when the signal aborts during backoff', async () => {
    const controller = new AbortController();
    const networkError = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const fetchMock = vi.fn().mockRejectedValue(networkError);
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchWithRetry('https://example.test', { signal: controller.signal }, 3);
    const captured = pending.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    controller.abort();
    await vi.runAllTimersAsync();

    const result = await captured;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((result as Error).name).toBe('AbortError');
  });

  it('returns the last retryable response when retries are exhausted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(503));
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(fetchWithRetry('https://example.test', {}, 1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((result as Response).status).toBe(503);
  });
});
