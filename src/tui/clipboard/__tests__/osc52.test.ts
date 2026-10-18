import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  writeOsc52Clipboard,
  extractLastCodeBlock,
  extractCleanText,
  copyToClipboard,
} from '../index.js';

describe('writeOsc52Clipboard', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TMUX;
    delete process.env.STY;
    delete process.env.TERM;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('writes standard OSC 52 sequence in bare terminal', () => {
    let written = '';
    const mockStream = {
      write: vi.fn((data: string) => {
        written = data;
        return true;
      }),
    } as unknown as NodeJS.WriteStream;

    const text = 'Hello, Wasteland!';
    const ok = writeOsc52Clipboard(text, mockStream);

    expect(ok).toBe(true);
    const expectedB64 = Buffer.from(text, 'utf-8').toString('base64');
    expect(written).toBe(`\x1b]52;c;${expectedB64}\x07`);
  });

  it('escapes and wraps in DCS under tmux environment', () => {
    process.env.TMUX = '/tmp/tmux-1000/default,1234,0';
    let written = '';
    const mockStream = {
      write: vi.fn((data: string) => {
        written = data;
        return true;
      }),
    } as unknown as NodeJS.WriteStream;

    const text = 'tmux test';
    const ok = writeOsc52Clipboard(text, mockStream);

    expect(ok).toBe(true);
    const b64 = Buffer.from(text, 'utf-8').toString('base64');
    const baseSeq = `\x1b]52;c;${b64}\x07`;
    const escapedSeq = baseSeq.replace(/\x1b/g, '\x1b\x1b');
    const expected = `\x1bPtmux;\x1b${escapedSeq}\x1b\\`;
    expect(written).toBe(expected);
    expect(written.startsWith('\x1bPtmux;\x1b\x1b\x1b]52;c;')).toBe(true);
    expect(written.endsWith('\x1b\\')).toBe(true);
  });

  it('wraps in DCS under GNU screen environment via TERM', () => {
    process.env.TERM = 'screen-256color';
    let written = '';
    const mockStream = {
      write: vi.fn((data: string) => {
        written = data;
        return true;
      }),
    } as unknown as NodeJS.WriteStream;

    const text = 'screen test';
    const ok = writeOsc52Clipboard(text, mockStream);

    expect(ok).toBe(true);
    const b64 = Buffer.from(text, 'utf-8').toString('base64');
    const baseSeq = `\x1b]52;c;${b64}\x07`;
    const expected = `\x1bP${baseSeq}\x1b\\`;
    expect(written).toBe(expected);
  });

  it('wraps in DCS under GNU screen environment via STY', () => {
    process.env.TERM = 'xterm-256color';
    process.env.STY = '1234.pts-0.host';
    let written = '';
    const mockStream = {
      write: vi.fn((data: string) => {
        written = data;
        return true;
      }),
    } as unknown as NodeJS.WriteStream;

    const text = 'screen STY test';
    const ok = writeOsc52Clipboard(text, mockStream);

    expect(ok).toBe(true);
    const b64 = Buffer.from(text, 'utf-8').toString('base64');
    const baseSeq = `\x1b]52;c;${b64}\x07`;
    const expected = `\x1bP${baseSeq}\x1b\\`;
    expect(written).toBe(expected);
  });

  it('defaults to process.stdout when stream is not provided', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const ok = writeOsc52Clipboard('stdout test');
    expect(ok).toBe(true);
    expect(stdoutSpy).toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });
});

describe('extractLastCodeBlock', () => {
  it('returns null when there are no code blocks', () => {
    expect(extractLastCodeBlock('Just some plain text.')).toBeNull();
  });

  it('extracts single code block body without language tags or delimiters', () => {
    const input = 'Here is the answer:\n```typescript\nconst x: number = 42;\nconsole.log(x);\n```\nDone!';
    expect(extractLastCodeBlock(input)).toBe('const x: number = 42;\nconsole.log(x);');
  });

  it('extracts the last code block when multiple blocks exist', () => {
    const input = [
      'First block:',
      '```python',
      'print("first")',
      '```',
      'Second block:',
      '```bash',
      'npm run build',
      '```',
    ].join('\n');
    expect(extractLastCodeBlock(input)).toBe('npm run build');
  });

  it('handles code block without language tag', () => {
    const input = '```\necho "hello world"\n```';
    expect(extractLastCodeBlock(input)).toBe('echo "hello world"');
  });

  it('handles code block without trailing newline before closing fence', () => {
    const input = '```js\nconst a = 1;```';
    expect(extractLastCodeBlock(input)).toBe('const a = 1;');
  });
});

describe('extractCleanText', () => {
  it('returns original trimmed text if no think tags exist', () => {
    expect(extractCleanText('   Hello World   ')).toBe('Hello World');
  });

  it('strips <think>...</think> tags and returns clean content', () => {
    const text = '<think>\nInternal deliberation...\n</think>\nActual user response.';
    expect(extractCleanText(text)).toBe('Actual user response.');
  });

  it('handles case-insensitive and multiple think blocks', () => {
    const text = '<THINK>thought 1</THINK>Part 1 <think>thought 2</think>Part 2';
    expect(extractCleanText(text)).toBe('Part 1 Part 2');
  });
});

describe('copyToClipboard', () => {
  it('copies clean text by default', () => {
    let written = '';
    const mockStream = {
      write: vi.fn((data: string) => {
        written = data;
        return true;
      }),
    } as unknown as NodeJS.WriteStream;

    const ok = copyToClipboard('<think>secret</think>Public text', { stream: mockStream });
    expect(ok).toBe(true);
    const b64 = Buffer.from('Public text', 'utf-8').toString('base64');
    expect(written).toContain(b64);
  });

  it('copies last code block when codeOnly is true', () => {
    let written = '';
    const mockStream = {
      write: vi.fn((data: string) => {
        written = data;
        return true;
      }),
    } as unknown as NodeJS.WriteStream;

    const ok = copyToClipboard('Explanation\n```ts\nconst x = 1;\n```', {
      codeOnly: true,
      stream: mockStream,
    });
    expect(ok).toBe(true);
    const b64 = Buffer.from('const x = 1;', 'utf-8').toString('base64');
    expect(written).toContain(b64);
  });

  it('returns false when codeOnly is true but no code block is found', () => {
    const mockStream = {
      write: vi.fn(() => true),
    } as unknown as NodeJS.WriteStream;

    const ok = copyToClipboard('No code here', { codeOnly: true, stream: mockStream });
    expect(ok).toBe(false);
    expect(mockStream.write).not.toHaveBeenCalled();
  });
});
