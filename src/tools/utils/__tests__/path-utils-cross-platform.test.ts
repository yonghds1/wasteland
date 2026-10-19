import { describe, it, expect } from 'vitest';
import {
  toPosixPath,
  normalizePath,
  isSubPath,
  resolveWithinCwd,
  normalizeToolInputPaths,
} from '../path-utils.js';

describe('toPosixPath', () => {
  it('正确将 Windows 反斜杠转换为正斜杠并大写盘符', () => {
    expect(toPosixPath('C:\\Users\\foo\\bar')).toBe('C:/Users/foo/bar');
    expect(toPosixPath('c:\\users\\foo\\bar')).toBe('C:/users/foo/bar');
    expect(toPosixPath('d:\\projects\\repo')).toBe('D:/projects/repo');
  });

  it('正确处理 Windows UNC 网络共享路径', () => {
    expect(toPosixPath('\\\\server\\share\\file.txt')).toBe('//server/share/file.txt');
    expect(toPosixPath('\\\\server\\share')).toBe('//server/share');
  });

  it('正确转换相对路径', () => {
    expect(toPosixPath('relative\\path\\to\\file')).toBe('relative/path/to/file');
    expect(toPosixPath('.\\src\\index.ts')).toBe('./src/index.ts');
  });

  it('消除多重冗余反斜杠与正斜杠', () => {
    expect(toPosixPath('foo//bar///baz')).toBe('foo/bar/baz');
    expect(toPosixPath('C:\\\\Users\\\\\\foo\\\\bar')).toBe('C:/Users/foo/bar');
    expect(toPosixPath('/foo//bar///baz')).toBe('/foo/bar/baz');
  });

  it('保留 file:/// 及其他协议头并大写其中的 Windows 盘符', () => {
    expect(toPosixPath('file:///c:/Users/test')).toBe('file:///C:/Users/test');
    expect(toPosixPath('file:///home/user/doc')).toBe('file:///home/user/doc');
    expect(toPosixPath('http://example.com//path///to//file')).toBe('http://example.com/path/to/file');
  });

  it('处理空字符串与非字符串防御', () => {
    expect(toPosixPath('')).toBe('');
    expect(toPosixPath(null as unknown as string)).toBe('');
    expect(toPosixPath(undefined as unknown as string)).toBe('');
  });
});

describe('normalizePath', () => {
  it('结合 path.normalize 消除相对路径段并转换为 POSIX 格式', () => {
    expect(normalizePath('C:\\Users\\foo\\..\\bar')).toBe('C:/Users/bar');
    expect(normalizePath('c:/users/foo/../bar')).toBe('C:/users/bar');
    expect(normalizePath('foo//bar/../baz')).toBe('foo/baz');
    expect(normalizePath('/home/user/../app')).toBe('/home/app');
  });

  it('处理带协议头的路径段解析', () => {
    expect(normalizePath('file:///c:/Users/foo/../bar')).toBe('file:///C:/Users/bar');
  });
});

describe('isSubPath', () => {
  it('同路径返回 true', () => {
    expect(isSubPath('/home/user/repo', '/home/user/repo')).toBe(true);
    expect(isSubPath('C:\\repo', 'c:/repo')).toBe(true);
  });

  it('子目录与子文件返回 true', () => {
    expect(isSubPath('/home/user/repo', '/home/user/repo/src/index.ts')).toBe(true);
    expect(isSubPath('C:\\repo', 'c:/repo/src/index.ts')).toBe(true);
    expect(isSubPath('c:/repo', 'C:/repo/deep/nested/file.txt')).toBe(true);
  });

  it('前缀重合但不是同级子路径返回 false', () => {
    expect(isSubPath('/home/user/app', '/home/user/app-backup')).toBe(false);
    expect(isSubPath('C:\\repo', 'C:\\repo-backup')).toBe(false);
  });

  it('越界与父级遍历返回 false', () => {
    expect(isSubPath('/home/user/app', '/home/user/app/../../etc/passwd')).toBe(false);
    expect(isSubPath('C:\\repo\\src', 'C:\\repo')).toBe(false);
    expect(isSubPath('C:\\repo', 'D:\\repo\\file.txt')).toBe(false);
  });
});

describe('resolveWithinCwd - 跨平台与安全治理', () => {
  it('Windows 盘符大小写不一致时正确放行（消除伪越界缺陷）', async () => {
    // baseCwd 小写，输入绝对路径大写
    const res1 = await resolveWithinCwd('c:\\repo', 'C:\\repo\\src\\index.ts');
    expect(res1).toBe('C:/repo/src/index.ts');

    // baseCwd 大写，输入绝对路径小写
    const res2 = await resolveWithinCwd('C:\\repo', 'c:\\repo\\src\\index.ts');
    expect(res2).toBe('C:/repo/src/index.ts');

    // POSIX 风格大小写盘符混用
    const res3 = await resolveWithinCwd('c:/repo', 'C:/repo/src/index.ts');
    expect(res3).toBe('C:/repo/src/index.ts');
  });

  it('放行正常相对路径并返回规范化 POSIX 路径', async () => {
    const res1 = await resolveWithinCwd('c:\\repo', 'src\\index.ts');
    expect(res1).toBe('C:/repo/src/index.ts');

    const res2 = await resolveWithinCwd('C:/repo', 'src/components/App.tsx');
    expect(res2).toBe('C:/repo/src/components/App.tsx');
  });

  it('跨目录遍历攻击（..\\..\\etc\\passwd）在 Windows 风格下被阻断', async () => {
    const res1 = await resolveWithinCwd('c:\\repo', '..\\..\\etc\\passwd');
    expect(res1).toBeNull();

    const res2 = await resolveWithinCwd('c:\\repo', '..\\..\\Windows\\System32\\cmd.exe');
    expect(res2).toBeNull();

    const res3 = await resolveWithinCwd('c:\\repo', '../../etc/passwd');
    expect(res3).toBeNull();
  });

  it('跨目录遍历攻击（../../etc/passwd）在 POSIX 风格下被精准阻断', async () => {
    const res = await resolveWithinCwd('/home/user/app', '../../etc/passwd');
    expect(res).toBeNull();
  });

  it('跨 Windows 驱动器盘符访问被阻断', async () => {
    const res = await resolveWithinCwd('c:\\repo', 'D:\\repo\\file.txt');
    expect(res).toBeNull();
  });

  it('无效、空字符串或非法类型输入返回 null', async () => {
    expect(await resolveWithinCwd('c:\\repo', '')).toBeNull();
    expect(await resolveWithinCwd('c:\\repo', '   ')).toBeNull();
    expect(await resolveWithinCwd('c:\\repo', null)).toBeNull();
    expect(await resolveWithinCwd('c:\\repo', 123)).toBeNull();
  });
});

describe('normalizeToolInputPaths', () => {
  it('对复合对象、嵌套参数与路径数组执行统一清洗', () => {
    const rawInput = {
      filePath: 'src\\components\\Button.tsx',
      cwd: 'c:\\repo',
      include: ['tests\\**\\*.test.ts', 'src\\utils\\*'],
      options: {
        dir: 'dist\\bundles',
        nestedPath: 'public\\assets\\logo.png',
        count: 42,
        enabled: true,
      },
      // 非路径属性应严格保持原样，不被误篡改
      command: 'echo "hello\\world"',
      content: 'Line 1\\nLine 2\\tTab',
      message: 'Notice: use \\ backslash',
    };

    const cleaned = normalizeToolInputPaths(rawInput);

    expect(cleaned.filePath).toBe('src/components/Button.tsx');
    expect(cleaned.cwd).toBe('C:/repo');
    expect(cleaned.include).toEqual(['tests/**/*.test.ts', 'src/utils/*']);
    expect(cleaned.options.dir).toBe('dist/bundles');
    expect(cleaned.options.nestedPath).toBe('public/assets/logo.png');
    expect(cleaned.options.count).toBe(42);
    expect(cleaned.options.enabled).toBe(true);

    // 确保非路径字段完好无损
    expect(cleaned.command).toBe('echo "hello\\world"');
    expect(cleaned.content).toBe('Line 1\\nLine 2\\tTab');
    expect(cleaned.message).toBe('Notice: use \\ backslash');
  });

  it('处理空值与非对象入参', () => {
    expect(normalizeToolInputPaths(null as unknown as Record<string, unknown>)).toBeNull();
    expect(normalizeToolInputPaths(undefined as unknown as Record<string, unknown>)).toBeUndefined();
    expect(normalizeToolInputPaths('string-val' as unknown as Record<string, unknown>)).toBe('string-val');
  });
});
