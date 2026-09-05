/**
 * provider-registry.test.ts - ProviderRegistry 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Observable } from 'rxjs';
import { ProviderRegistry, createDefaultProviderRegistry } from '../provider-registry.js';
import type { AgentProvider, ProviderStepInput, ProviderStreamEvent } from '../provider-types.js';

// Mock factory for testing
const mockFactory = (): AgentProvider => ({
  id: 'mock',
  runStep: (_input: ProviderStepInput): Observable<ProviderStreamEvent> => {
    return new Observable((subscriber) => {
      subscriber.next({ type: 'assistant_message', text: 'mock response' });
      subscriber.complete();
    });
  },
});

const anotherMockFactory = (): AgentProvider => ({
  id: 'another-mock',
  runStep: (_input: ProviderStepInput): Observable<ProviderStreamEvent> => {
    return new Observable((subscriber) => {
      subscriber.next({ type: 'assistant_message', text: 'another mock response' });
      subscriber.complete();
    });
  },
});

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('register', () => {
    it('should register a factory', () => {
      registry.register('mock', mockFactory);
      expect(registry.list()).toContain('mock');
    });

    it('should register multiple factories', () => {
      registry.register('mock', mockFactory);
      registry.register('another-mock', anotherMockFactory);
      expect(registry.list()).toHaveLength(2);
      expect(registry.list()).toContain('mock');
      expect(registry.list()).toContain('another-mock');
    });

    it('should throw on duplicate type', () => {
      registry.register('mock', mockFactory);
      expect(() => registry.register('mock', anotherMockFactory)).toThrow();
    });

    it('should throw on empty type', () => {
      expect(() => registry.register('', mockFactory)).toThrow();
    });

    it('should throw on whitespace-only type', () => {
      expect(() => registry.register('   ', mockFactory)).toThrow();
    });

    it('should trim type before registration', () => {
      registry.register('  mock  ', mockFactory);
      expect(registry.list()).toContain('mock');
    });
  });

  describe('resolve', () => {
    it('should resolve by direct id match', () => {
      registry.register('mock', mockFactory);
      const provider = registry.resolve('mock');
      expect(provider.id).toBe('mock');
    });

    it('should resolve by config.type', () => {
      registry.register('mock', mockFactory);
      const provider = registry.resolve('some-id', { type: 'mock' });
      expect(provider.id).toBe('mock');
    });

    it('should prefer config.type over direct id', () => {
      registry.register('mock', mockFactory);
      registry.register('another-mock', anotherMockFactory);
      const provider = registry.resolve('another-mock', { type: 'mock' });
      expect(provider.id).toBe('mock');
    });

    it('should throw on unsupported type', () => {
      registry.register('mock', mockFactory);
      expect(() => registry.resolve('some-id', { type: 'unsupported' })).toThrow();
    });

    it('should throw on unsupported id', () => {
      registry.register('mock', mockFactory);
      expect(() => registry.resolve('unsupported')).toThrow();
    });

    it('should pass config to factory', () => {
      let receivedConfig: unknown = null;
      const capturingFactory = (): AgentProvider => ({
        id: 'capturing',
        runStep: () => new Observable(),
      });
      const factoryWithCapture = (config?: Record<string, unknown>): AgentProvider => {
        receivedConfig = config;
        return capturingFactory();
      };

      registry.register('capturing', factoryWithCapture as Parameters<typeof registry.register>[1]);
      registry.resolve('capturing', { apiKey: 'test-key', model: 'test-model' });
      expect(receivedConfig).toEqual({ apiKey: 'test-key', model: 'test-model' });
    });
  });

  describe('listTypes', () => {
    it('should return empty array when no factories registered', () => {
      expect(registry.listTypes()).toEqual([]);
    });

    it('should return all registered types', () => {
      registry.register('mock', mockFactory);
      registry.register('another-mock', anotherMockFactory);
      expect(registry.listTypes()).toHaveLength(2);
      expect(registry.listTypes()).toContain('mock');
      expect(registry.listTypes()).toContain('another-mock');
    });

    it('should return sorted types', () => {
      registry.register('zebra', mockFactory);
      registry.register('alpha', anotherMockFactory);
      expect(registry.listTypes()).toEqual(['alpha', 'zebra']);
    });
  });

  describe('list', () => {
    it('should return empty array when no factories registered', () => {
      expect(registry.list()).toEqual([]);
    });

    it('should return all registered types', () => {
      registry.register('mock', mockFactory);
      registry.register('another-mock', anotherMockFactory);
      expect(registry.list()).toHaveLength(2);
      expect(registry.list()).toContain('mock');
      expect(registry.list()).toContain('another-mock');
    });
  });

  describe('constructor', () => {
    it('should register entries from constructor', () => {
      const entries: Array<[string, typeof mockFactory]> = [
        ['mock', mockFactory],
        ['another-mock', anotherMockFactory],
      ];
      const reg = new ProviderRegistry(entries);
      expect(reg.list()).toHaveLength(2);
      expect(reg.list()).toContain('mock');
      expect(reg.list()).toContain('another-mock');
    });

    it('should work with empty entries', () => {
      const reg = new ProviderRegistry([]);
      expect(reg.list()).toEqual([]);
    });

    it('should work without entries parameter', () => {
      const reg = new ProviderRegistry();
      expect(reg.list()).toEqual([]);
    });
  });
});

describe('createDefaultProviderRegistry', () => {
  it('should create registry with default providers', () => {
    const registry = createDefaultProviderRegistry();
    const types = registry.listTypes();

    expect(types).toContain('local');
    expect(types).toContain('openai-compatible');
    expect(types).toContain('anthropic');
  });

  it('should resolve local provider', () => {
    const registry = createDefaultProviderRegistry();
    const provider = registry.resolve('local');
    expect(provider.id).toBe('local');
  });

  it('should resolve openai-compatible provider', () => {
    const registry = createDefaultProviderRegistry();
    const provider = registry.resolve('openai-compatible', {
      apiKey: 'test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4',
    });
    expect(provider.id).toBe('openai-compatible');
  });

  it('should resolve anthropic provider', () => {
    const registry = createDefaultProviderRegistry();
    const provider = registry.resolve('anthropic', {
      apiKey: 'test',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-3-opus-20240229',
    });
    expect(provider.id).toBe('anthropic');
  });
});
