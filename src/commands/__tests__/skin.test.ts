import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSkinCommand } from '../skin.js';

describe('createSkinCommand', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const originalExitCode = process.exitCode;

  let testDir: string;
  let logOutput: string[];
  let errorOutput: string[];

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'wasteland-skin-command-'));
    process.env.HOME = testDir;
    process.chdir(testDir);
    process.exitCode = undefined;

    logOutput = [];
    errorOutput = [];

    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorOutput.push(args.join(' '));
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();

    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  async function setupSettings(skinId: string = 'warlord-immortal'): Promise<string> {
    const configDir = join(testDir, '.wasteland');
    await mkdir(configDir, { recursive: true });
    const settingsPath = join(configDir, 'settings.json');
    await writeFile(
      settingsPath,
      JSON.stringify({ runtime: { skinId } }, null, 2),
      'utf8'
    );
    return settingsPath;
  }

  describe('/skin list', () => {
    it('正确输出所有可用皮肤，当前选中标记为 ●，其他为 ○', async () => {
      await setupSettings('warlord-immortal');
      const command = createSkinCommand();

      await command.parseAsync(['list'], { from: 'user' });

      const output = logOutput.join('\n');
      expect(output).toContain('可用皮肤:');
      // 当前选中的皮肤有 ● 标记
      expect(output).toMatch(/●\s+warlord-immortal/);
      expect(output).toContain('名称: 不死老蕉');
      // 未选中的皮肤有 ○ 标记
      expect(output).toMatch(/○\s+road-nomad/);
      expect(output).toContain('名称: 疯子麦克');
      expect(output).toMatch(/○\s+fury-vanguard/);
    });

    it('当切换当前选中的皮肤时，● 标记对应切换', async () => {
      await setupSettings('road-nomad');
      const command = createSkinCommand();

      await command.parseAsync(['list'], { from: 'user' });

      const output = logOutput.join('\n');
      expect(output).toMatch(/●\s+road-nomad/);
      expect(output).toMatch(/○\s+warlord-immortal/);
    });
  });

  describe('/skin show', () => {
    it('显示当前选中的皮肤详情', async () => {
      await setupSettings('fury-vanguard');
      const command = createSkinCommand();

      await command.parseAsync(['show'], { from: 'user' });

      const output = logOutput.join('\n');
      expect(output).toContain('当前皮肤: fury-vanguard');
      expect(output).toContain('名称: 独臂弗莎');
    });

    it('无配置时回退显示默认皮肤详情', async () => {
      // 不初始化 settings.json
      const command = createSkinCommand();

      await command.parseAsync(['show'], { from: 'user' });

      const output = logOutput.join('\n');
      expect(output).toContain('当前皮肤:');
      expect(output).toContain('名称: 不死老蕉');
    });
  });

  describe('/skin info <skinId>', () => {
    it('查看指定合法皮肤详情（包含思考文案、欢迎语、口头禅条数）', async () => {
      await setupSettings('warlord-immortal');
      const command = createSkinCommand();

      await command.parseAsync(['info', 'fury-vanguard'], { from: 'user' });

      const output = logOutput.join('\n');
      expect(output).toContain('皮肤详情: 独臂弗莎');
      expect(output).toContain('ID: fury-vanguard');
      expect(output).toContain('思考文案: 3 条');
      expect(output).toContain('欢迎语: 3 条');
      expect(output).toContain('口头禅: 3 条');
    });

    it('查看带自定义颜色的皮肤时输出颜色信息', async () => {
      const configDir = join(testDir, '.wasteland');
      await mkdir(configDir, { recursive: true });
      const customSkinFile = {
        skins: {
          'custom-chroma': {
            label: '炫彩巡鹰',
            thinking: ['调频中...'],
            greeting: ['声波共鸣！'],
            catchphrases: ['撕裂寂静！'],
            colors: {
              label: '#ffaa00',
              text: '#ffffff',
            },
          },
        },
        singleAgent: { skin: 'custom-chroma' },
      };
      await writeFile(join(configDir, 'skins.json'), JSON.stringify(customSkinFile), 'utf8');

      const command = createSkinCommand();
      await command.parseAsync(['info', 'custom-chroma'], { from: 'user' });

      const output = logOutput.join('\n');
      expect(output).toContain('皮肤详情: 炫彩巡鹰');
      expect(output).toContain('颜色:');
    });
  });

  describe('/skin load <skinId>', () => {
    it('成功分支：加载合法皮肤更新持久化配置并输出成功提示', async () => {
      const settingsPath = await setupSettings('warlord-immortal');
      const command = createSkinCommand();

      await command.parseAsync(['load', 'road-nomad'], { from: 'user' });

      const output = logOutput.join('\n');
      expect(output).toContain('已加载皮肤: 疯子麦克 (road-nomad)');
      expect(process.exitCode).toBeUndefined();

      // 验证 settings.json 持久化更新
      const content = JSON.parse(await readFile(settingsPath, 'utf8'));
      expect(content.runtime?.skinId).toBe('road-nomad');
    });

    it('失败分支：传入非法皮肤 ID 输出错误提示且设置 exitCode = 1', async () => {
      const settingsPath = await setupSettings('warlord-immortal');
      const command = createSkinCommand();

      await command.parseAsync(['load', 'non-existent-cyborg'], { from: 'user' });

      const errorText = errorOutput.join('\n');
      expect(errorText).toContain('错误: 皮肤 "non-existent-cyborg" 不存在');
      expect(process.exitCode).toBe(1);

      // 验证未更新配置
      const content = JSON.parse(await readFile(settingsPath, 'utf8'));
      expect(content.runtime?.skinId).toBe('warlord-immortal');
    });
  });
});
