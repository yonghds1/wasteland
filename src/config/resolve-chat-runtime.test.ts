import { describe, it, expect } from 'vitest';
import { redactSensitiveConfig } from './resolve-chat-runtime.js';

describe('redactSensitiveConfig', () => {
  it('redacts apiKey key', () => {
    const result = redactSensitiveConfig({ apiKey: 'sk-123' });
    expect(result).toEqual({ apiKey: '***' });
  });

  it('redacts api_key key', () => {
    const result = redactSensitiveConfig({ api_key: 'secret' });
    expect(result).toEqual({ api_key: '***' });
  });

  it('redacts token key', () => {
    const result = redactSensitiveConfig({ token: 'abc' });
    expect(result).toEqual({ token: '***' });
  });

  it('redacts secret key', () => {
    const result = redactSensitiveConfig({ secret: 'xyz' });
    expect(result).toEqual({ secret: '***' });
  });

  it('redacts password key', () => {
    const result = redactSensitiveConfig({ password: 'pw123' });
    expect(result).toEqual({ password: '***' });
  });

  it('case insensitive', () => {
    const result = redactSensitiveConfig({
      ApiKey: 'a',
      API_KEY: 'b',
      Secret: 'c',
      TOKEN: 'd',
    });
    expect(result).toEqual({ ApiKey: '***', API_KEY: '***', Secret: '***', TOKEN: '***' });
  });

  it('preserves non-sensitive keys', () => {
    const result = redactSensitiveConfig({ name: 'test', count: 42 });
    expect(result).toEqual({ name: 'test', count: 42 });
  });

  it('redacts nested objects', () => {
    const result = redactSensitiveConfig({
      provider: { apiKey: 'sk-123', baseUrl: 'https://api.com' },
    });
    expect(result).toEqual({
      provider: { apiKey: '***', baseUrl: 'https://api.com' },
    });
  });

  it('redacts in arrays', () => {
    const result = redactSensitiveConfig([
      { token: 'a' },
      { name: 'b' },
    ]);
    expect(result).toEqual([{ token: '***' }, { name: 'b' }]);
  });

  it('returns primitives as-is', () => {
    expect(redactSensitiveConfig('hello')).toBe('hello');
    expect(redactSensitiveConfig(42)).toBe(42);
    expect(redactSensitiveConfig(true)).toBe(true);
  });

  it('returns null as-is', () => {
    expect(redactSensitiveConfig(null)).toBe(null);
  });

  it('returns empty object', () => {
    expect(redactSensitiveConfig({})).toEqual({});
  });
});
