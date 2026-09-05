import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildModelsUrl,
  extractModelIdsFromJson,
  extractModelInfosFromJson,
  fetchRemoteModels,
} from '../fetch-models.js';

describe('fetch-models', () => {
  describe('buildModelsUrl', () => {
    it('appends /models to base URL without trailing slash', () => {
      expect(buildModelsUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/models');
    });

    it('strips trailing slashes before appending /models', () => {
      expect(buildModelsUrl('https://api.deepseek.com/v1///')).toBe('https://api.deepseek.com/v1/models');
    });

    it('does not double append if already ending with /models', () => {
      expect(buildModelsUrl('https://api.openai.com/v1/models')).toBe('https://api.openai.com/v1/models');
    });
  });

  describe('extractModelIdsFromJson', () => {
    it('parses standard OpenAI response with data array of objects', () => {
      const data = {
        object: 'list',
        data: [
          { id: 'gpt-4o', object: 'model' },
          { id: 'gpt-4o-mini', object: 'model' },
          { id: 'o1-preview', object: 'model' },
        ],
      };
      expect(extractModelIdsFromJson(data)).toEqual(['gpt-4o', 'gpt-4o-mini', 'o1-preview']);
    });

    it('parses Ollama format with models array of objects or strings', () => {
      const data = {
        models: [
          { name: 'llama3:latest' },
          { id: 'deepseek-r1:7b' },
          'qwen2.5-coder:latest',
        ],
      };
      expect(extractModelIdsFromJson(data)).toEqual([
        'llama3:latest',
        'deepseek-r1:7b',
        'qwen2.5-coder:latest',
      ]);
    });

    it('parses top-level array of model objects', () => {
      const data = [
        { id: 'claude-3-7-sonnet' },
        { id: 'deepseek-chat' },
      ];
      expect(extractModelIdsFromJson(data)).toEqual([
        'claude-3-7-sonnet',
        'deepseek-chat',
      ]);
    });

    it('returns empty array on invalid input', () => {
      expect(extractModelIdsFromJson(null)).toEqual([]);
      expect(extractModelIdsFromJson({})).toEqual([]);
      expect(extractModelIdsFromJson({ data: 'not-array' })).toEqual([]);
    });

    it('deduplicates identical model IDs', () => {
      const data = {
        data: [{ id: 'gpt-4o' }, { id: 'gpt-4o' }, { id: 'deepseek-chat' }],
      };
      expect(extractModelIdsFromJson(data)).toEqual(['gpt-4o', 'deepseek-chat']);
    });
  });

  describe('fetchRemoteModels', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('returns empty if baseUrl is empty', async () => {
      const result = await fetchRemoteModels({ baseUrl: '   ' });
      expect(result.success).toBe(false);
      expect(result.models).toEqual([]);
    });

    it('successfully fetches and extracts models with authorization header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'deepseek-chat' },
            { id: 'deepseek-reasoner' },
          ],
        }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await fetchRemoteModels({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-test-123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.deepseek.com/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test-123',
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    });

    it('returns success: false and models: [] when HTTP response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await fetchRemoteModels({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-invalid',
      });

      expect(result.success).toBe(false);
      expect(result.models).toEqual([]);
      expect(result.error).toContain('HTTP 401');
    });

    it('returns success: false and models: [] on network error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await fetchRemoteModels({
        baseUrl: 'http://localhost:11434/v1',
      });

      expect(result.success).toBe(false);
      expect(result.models).toEqual([]);
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('extractModelInfosFromJson', () => {
    it('提取服务端返回的 context_length / context_window', () => {
      const data = {
        data: [
          { id: 'custom-model-1', context_length: 262144 },
          { id: 'custom-model-2', context_window: 131072 },
        ],
      };
      const infos = extractModelInfosFromJson(data);
      expect(infos).toEqual([
        { id: 'custom-model-1', contextWindow: 262144 },
        { id: 'custom-model-2', contextWindow: 131072 },
      ]);
    });

    it('服务端未返回 context_length 时从 Profile 画像推断', () => {
      const data = {
        data: [
          { id: 'mimo-v2.5' },
          { id: 'claude-3-7-sonnet' },
        ],
      };
      const infos = extractModelInfosFromJson(data);
      expect(infos).toEqual([
        { id: 'mimo-v2.5', contextWindow: 262144 },
        { id: 'claude-3-7-sonnet', contextWindow: 200000 },
      ]);
    });
  });
});
