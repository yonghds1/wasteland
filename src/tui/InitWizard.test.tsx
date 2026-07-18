import { describe, expect, it } from 'vitest';

import {
  validateApiKey,
  validateBaseUrl,
  validateModelId,
  validateProviderName,
} from './InitWizard.js';

describe('InitWizard validators', () => {
  describe('validateProviderName', () => {
    it('rejects empty and invalid characters', () => {
      expect(validateProviderName('')).toBeTruthy();
      expect(validateProviderName('  ')).toBeTruthy();
      expect(validateProviderName('has space')).toBeTruthy();
      expect(validateProviderName('has/slash')).toBeTruthy();
    });
    it('accepts valid names', () => {
      expect(validateProviderName('deepseek')).toBeNull();
      expect(validateProviderName('my-provider_1')).toBeNull();
      expect(validateProviderName('OPENAI')).toBeNull();
    });
  });

  describe('validateBaseUrl', () => {
    it('rejects empty and non-http URLs', () => {
      expect(validateBaseUrl('')).toBeTruthy();
      expect(validateBaseUrl('api.example.com')).toBeTruthy();
      expect(validateBaseUrl('ftp://example.com')).toBeTruthy();
    });
    it('accepts http and https', () => {
      expect(validateBaseUrl('https://api.deepseek.com/v1')).toBeNull();
      expect(validateBaseUrl('http://localhost:8080')).toBeNull();
    });
  });

  describe('validateApiKey', () => {
    it('rejects empty', () => {
      expect(validateApiKey('')).toBeTruthy();
      expect(validateApiKey('   ')).toBeTruthy();
    });
    it('accepts anything non-empty', () => {
      expect(validateApiKey('sk-xxx')).toBeNull();
    });
  });

  describe('validateModelId', () => {
    it('rejects empty', () => {
      expect(validateModelId('')).toBeTruthy();
    });
    it('accepts non-empty', () => {
      expect(validateModelId('deepseek-chat')).toBeNull();
    });
  });
});
