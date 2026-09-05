/**
 * debug-logger.test.ts - FileSink 启动装配测试
 *
 * 覆盖：
 * - enableDebugLog() → level 升到 debug
 * - initializeFileSinkFromEnv() 幂等 + FileSink 注入
 * - env 变量解析
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetForTest, enableDebugLog, initializeFileSinkFromEnv } from '../debug-logger.js';
import { Logger } from '../../logger/index.js';

describe('debug-logger', () => {
  let scratchDir: string;

  beforeEach(() => {
    _resetForTest();
    scratchDir = mkdtempSync(join(tmpdir(), 'wasteland-debug-logger-'));
  });

  afterEach(() => {
    _resetForTest();
    rmSync(scratchDir, { recursive: true, force: true });
  });

  describe('enableDebugLog()', () => {
    it('should set level to debug', () => {
      enableDebugLog();
      expect(Logger.getLevel()).toBe('debug');
    });
  });

  describe('initializeFileSinkFromEnv()', () => {
    it('should install FileSink into target dir', async () => {
      const env: NodeJS.ProcessEnv = {
        WASTELAND_LOG_LEVEL: 'debug',
        WASTELAND_LOG_DIR: scratchDir,
        WASTELAND_LOG_REDACT: 'true',
      };
      initializeFileSinkFromEnv({ cwd: scratchDir, env });
      Logger.info({ sessionId: 'sid', scope: 'session', message: 'first' });
      await new Promise((resolve) => setTimeout(resolve, 80));
      const sessionsDir = join(scratchDir, 'sessions');
      const files = readdirSync(sessionsDir);
      expect(files.some((f) => f.endsWith('.jsonl'))).toBe(true);
    });

    it('should be idempotent', () => {
      const env: NodeJS.ProcessEnv = { WASTELAND_LOG_DIR: scratchDir };
      initializeFileSinkFromEnv({ cwd: scratchDir, env });
      initializeFileSinkFromEnv({ cwd: scratchDir, env });
      expect(Logger.hasBus()).toBe(true);
    });

    it('should fall back to info when WASTELAND_LOG_LEVEL is invalid', () => {
      const env: NodeJS.ProcessEnv = { WASTELAND_LOG_LEVEL: 'verbose' };
      initializeFileSinkFromEnv({ cwd: scratchDir, env });
      expect(Logger.getLevel()).toBe('info');
    });

    it('should propagate WASTELAND_LOG_TAIL_LINES to env', () => {
      const env: NodeJS.ProcessEnv = { WASTELAND_LOG_TAIL_LINES: '100' };
      initializeFileSinkFromEnv({ cwd: scratchDir, env });
      expect(Logger.getEnv().tailLines).toBe(100);
    });

    it('should use WASTELAND_DEBUG=1 as equivalent to debug level', () => {
      const env: NodeJS.ProcessEnv = { WASTELAND_DEBUG: '1' };
      initializeFileSinkFromEnv({ cwd: scratchDir, env });
      expect(Logger.getLevel()).toBe('debug');
    });

    it('should default redact to true when WASTELAND_LOG_REDACT is unset', () => {
      const env: NodeJS.ProcessEnv = {};
      initializeFileSinkFromEnv({ cwd: scratchDir, env });
      expect(Logger.getEnv().redact).toBe(true);
    });
  });
});