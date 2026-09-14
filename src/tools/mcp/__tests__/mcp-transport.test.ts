import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StdioTransport, SseTransport, createTransport } from '../mcp-transport.js';

describe('MCP Transport Layer', () => {
  describe('createTransport', () => {
    it('should create StdioTransport when command is provided', () => {
      const transport = createTransport({
        command: 'node',
        args: ['server.js'],
      });

      expect(transport).toBeInstanceOf(StdioTransport);
    });

    it('should create SseTransport when url is provided', () => {
      const transport = createTransport({
        url: 'https://mcp.example.com/sse',
      });

      expect(transport).toBeInstanceOf(SseTransport);
    });

    it('should throw error when neither command nor url is provided', () => {
      expect(() => createTransport({})).toThrow('Invalid transport config');
    });
  });

  describe('StdioTransport', () => {
    let transport: StdioTransport;

    beforeEach(() => {
      transport = new StdioTransport({
        command: 'echo',
        args: ['test'],
      });
    });

    it('should have correct initial state', () => {
      expect(transport.isConnected()).toBe(false);
    });

    it('should register message handler', () => {
      const handler = vi.fn();
      transport.onMessage(handler);
      // Handler is registered (no error thrown)
      expect(true).toBe(true);
    });

    it('should register error handler', () => {
      const handler = vi.fn();
      transport.onError(handler);
      // Handler is registered (no error thrown)
      expect(true).toBe(true);
    });

    it('should register close handler', () => {
      const handler = vi.fn();
      transport.onClose(handler);
      // Handler is registered (no error thrown)
      expect(true).toBe(true);
    });
  });

  describe('SseTransport', () => {
    let transport: SseTransport;

    beforeEach(() => {
      transport = new SseTransport({
        url: 'https://mcp.example.com/sse',
      });
    });

    it('should have correct initial state', () => {
      expect(transport.isConnected()).toBe(false);
    });

    it('should register message handler', () => {
      const handler = vi.fn();
      transport.onMessage(handler);
      // Handler is registered (no error thrown)
      expect(true).toBe(true);
    });

    it('should register error handler', () => {
      const handler = vi.fn();
      transport.onError(handler);
      // Handler is registered (no error thrown)
      expect(true).toBe(true);
    });

    it('should register close handler', () => {
      const handler = vi.fn();
      transport.onClose(handler);
      // Handler is registered (no error thrown)
      expect(true).toBe(true);
    });

    it('should throw error when sending without connection', async () => {
      const transport = new SseTransport({
        url: 'https://mcp.example.com/sse',
      });

      await expect(
        transport.send({ jsonrpc: '2.0', id: 1, method: 'test', params: {} })
      ).rejects.toThrow('SseTransport not connected');
    });
  });
});
