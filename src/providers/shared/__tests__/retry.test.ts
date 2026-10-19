import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry, isRetryableStatus, isRetryableError } from '../retry.js';

function makeResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

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
  it('rejects AbortError and non-Error values', () => {
    expect(isRetryableError(Object.assign(new Error('abort'), { name: 'AbortError' }))).toBe(false);
    expect(isRetryableError('error string')).toBe(false);
  });

  it('accepts network error codes directly and via cause', () => {
    expect(isRetryableError(Object.assign(new Error('boom'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryableError(Object.assign(new Error('boom'), { code: 'ETIMEDOUT' }))).toBe(true);
    const withCause = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    });
    expect(isRetryableError(withCause)).toBe(true);
  });

  it('accepts transient undici codes and message patterns', () => {
    expect(isRetryableError(Object.assign(new Error('boom'), { code: 'UND_ERR_SOCKET' }))).toBe(true);
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableError(new Error('socket hang up'))).toBe(true);
  });

  it('rejects aborted causes and non-transient error codes', () => {
    const abortedCause = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('aborted'), { name: 'AbortError' }),
    });
    expect(isRetryableError(abortedCause)).toBe(false);
    expect(isRetryableError(Object.assign(new Error('boom'), { code: 'UND_ERR_ABORTED' }))).toBe(false);
    const notFound = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
    });
    expect(isRetryableError(notFound)).toBe(false);
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

  it('returns response immediately on successful 200 without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWithRetry('https://example.test', {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(200);
  });

  it.each([400, 401, 403])('returns client error %i immediately without retrying', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(status));
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(fetchWithRetry('https://example.test', {}, 3));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((result as Response).status).toBe(status);
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

  it('follows exponential backoff ladder on 502/503 responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(502))
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchWithRetry('https://example.test', {}, 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // retries=3: delay = 1000 * 2^0 = 1000ms
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // retries=2: delay = 1000 * 2^1 = 2000ms
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const result = await pending;
    expect(result.status).toBe(200);
  });

  it('follows exponential backoff ladder on network errors (ECONNRESET, ETIMEDOUT)', async () => {
    const econnreset = Object.assign(new Error('conn reset'), { code: 'ECONNRESET' });
    const etimedout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(econnreset)
      .mockRejectedValueOnce(etimedout)
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchWithRetry('https://example.test', {}, 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 1st backoff: 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 2nd backoff: 2000ms
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const result = await pending;
    expect(result.status).toBe(200);
  });

  it('throws original network error when max retries are exhausted', async () => {
    const networkError = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const fetchMock = vi.fn().mockRejectedValue(networkError);
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(fetchWithRetry('https://example.test', {}, 2));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toBe(networkError);
  });

  it('returns last retryable status when max retries are exhausted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(503));
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(fetchWithRetry('https://example.test', {}, 2));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((result as Response).status).toBe(503);
  });

  it('falls back to exponential backoff when Retry-After is absent or invalid', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, { 'Retry-After': 'invalid-date' }))
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

  it('does not retry AbortError or when signal is already aborted', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(fetchWithRetry('https://example.test', {}, 3));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(abortError);

    const controller = new AbortController();
    controller.abort();
    const fetchMock2 = vi.fn().mockRejectedValue(new Error('fetch failed'));
    vi.stubGlobal('fetch', fetchMock2);
    const result2 = await settle(fetchWithRetry('https://example.test', { signal: controller.signal }, 3));
    expect(fetchMock2).toHaveBeenCalledTimes(1);
    expect(result2).toBeInstanceOf(Error);
  });

  it('stops waiting and throws AbortError when signal aborts during backoff', async () => {
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
});
