import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { InputPipeline } from '../input-pipeline.js';

describe('InputPipeline', () => {
  it('正确拦截并消费 SGR 鼠标滚轮帧，阻断向下游发送', () => {
    const mockStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    const pipeline = new InputPipeline();
    pipeline.attach(mockStdin);

    const mouseHandler = vi.fn();
    pipeline.on('mouse', mouseHandler);

    const downstreamDataHandler = vi.fn();
    mockStdin.on('data', downstreamDataHandler);

    // 模拟终端发送滚轮向上报文
    mockStdin.emit('data', '\x1b[<64;50;20M');

    // 验证：pipeline 收到强类型鼠标事件
    expect(mouseHandler).toHaveBeenCalledWith({
      kind: 'wheel-up',
      x: 50,
      y: 20,
    });

    // 验证：下游普通 data 监听器被阻断（未收到任何控制字符）
    expect(downstreamDataHandler).not.toHaveBeenCalled();

    pipeline.detach();
  });

  it('普通按键和文本数据正常透传给下游', () => {
    const mockStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    const pipeline = new InputPipeline();
    pipeline.attach(mockStdin);

    const mouseHandler = vi.fn();
    pipeline.on('mouse', mouseHandler);

    const downstreamDataHandler = vi.fn();
    mockStdin.on('data', downstreamDataHandler);

    // 模拟用户键盘输入 'hello'
    mockStdin.emit('data', 'hello');

    // 验证：鼠标事件未被触发
    expect(mouseHandler).not.toHaveBeenCalled();

    // 验证：下游正常收到 'hello'
    expect(downstreamDataHandler).toHaveBeenCalledWith('hello');

    pipeline.detach();
  });

  it('多报文与鼠标点击/释放序列被完全提取并阻断，不泄露到下游', () => {
    const mockStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    const pipeline = new InputPipeline();
    pipeline.attach(mockStdin);

    const mouseHandler = vi.fn();
    pipeline.on('mouse', mouseHandler);

    const downstreamDataHandler = vi.fn();
    mockStdin.on('data', downstreamDataHandler);

    // 模拟终端一次性发送连续滚轮与点击释放报文
    mockStdin.emit('data', '\x1b[<64;10;20M\x1b[<65;10;20M\x1b[<0;47;35M\x1b[<0;47;35m');

    expect(mouseHandler).toHaveBeenCalledTimes(4);
    expect(mouseHandler).toHaveBeenNthCalledWith(1, { kind: 'wheel-up', x: 10, y: 20 });
    expect(mouseHandler).toHaveBeenNthCalledWith(2, { kind: 'wheel-down', x: 10, y: 20 });
    expect(mouseHandler).toHaveBeenNthCalledWith(3, { kind: 'down', x: 47, y: 35 });
    expect(mouseHandler).toHaveBeenNthCalledWith(4, { kind: 'up', x: 47, y: 35 });
    expect(downstreamDataHandler).not.toHaveBeenCalled();

    pipeline.detach();
  });

  it('识别 Kitty 扩展换行序列 \\x1b[13;2u 并重写 key 为 return + shift + alt', () => {
    const mockStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    const pipeline = new InputPipeline();
    pipeline.attach(mockStdin);

    const keypressHandler = vi.fn();
    mockStdin.on('keypress', keypressHandler);

    mockStdin.emit('keypress', '\x1b[13;2u', { sequence: '\x1b[13;2u' });

    expect(keypressHandler).toHaveBeenCalledWith(
      '\x1b[13;2u',
      expect.objectContaining({
        name: 'return',
        return: true,
        shift: true,
        alt: true,
      })
    );

    pipeline.detach();
  });

  it('识别 xterm 扩展换行序列 \\x1b[27;2;13~ 并重写 key 为 return + shift + alt', () => {
    const mockStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    const pipeline = new InputPipeline();
    pipeline.attach(mockStdin);

    const keypressHandler = vi.fn();
    mockStdin.on('keypress', keypressHandler);

    mockStdin.emit('keypress', undefined, { sequence: '\x1b[27;2;13~' });

    expect(keypressHandler).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        name: 'return',
        return: true,
        shift: true,
        alt: true,
      })
    );

    pipeline.detach();
  });

  it('识别 Alt+Enter (\\x1b\\r 与 \\x1b\\n) 序列并重写 key 为 return + shift + alt', () => {
    const mockStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    const pipeline = new InputPipeline();
    pipeline.attach(mockStdin);

    const keypressHandler = vi.fn();
    mockStdin.on('keypress', keypressHandler);

    mockStdin.emit('keypress', '\r', { sequence: '\x1b\r' });
    mockStdin.emit('keypress', '\n', { sequence: '\x1b\n' });

    expect(keypressHandler).toHaveBeenNthCalledWith(
      1,
      '\r',
      expect.objectContaining({
        name: 'return',
        return: true,
        shift: true,
        alt: true,
      })
    );

    expect(keypressHandler).toHaveBeenNthCalledWith(
      2,
      '\n',
      expect.objectContaining({
        name: 'return',
        return: true,
        shift: true,
        alt: true,
      })
    );

    pipeline.detach();
  });
});
