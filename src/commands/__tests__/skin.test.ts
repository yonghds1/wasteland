import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSkinCommand } from '../skin.js';

const originalCwd = process.cwd();
const originalHome = process.env.HOME;

afterEach(() => {
  process.chdir(originalCwd);
  process.env.HOME = originalHome;
  vi.restoreAllMocks();
});

describe('createSkinCommand', () => {
  it('initializes skin registry before listing skins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wasteland-skin-command-'));
    process.env.HOME = dir;
    const configDir = join(dir, '.wasteland');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'settings.json'),
      JSON.stringify({ runtime: { skinId: 'warlord-immortal' } }),
      'utf8'
    );
    process.chdir(dir);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const command = createSkinCommand();

    await command.parseAsync(['list'], { from: 'user' });

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('不死老蕉');
    expect(output).toContain('疯子麦克');
  });
});
