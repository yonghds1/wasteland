import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectProjectRules,
  getProjectRulesSection,
  MAX_PROJECT_RULES_LENGTH,
  PROJECT_RULES_CANDIDATES,
  RULES_TRUNCATION_NOTICE,
} from '../project-rules-loader.js';
import { assemblePrompt, PromptAssembler } from '../prompt-assembler.js';
import type { PromptTemplate } from '../prompt-types.js';

describe('ProjectRulesLoader - 项目规则与架构记忆自动装配器', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wasteland-rules-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('detectProjectRules 优先级探测', () => {
    it('候选列表优先级按生态标准依序排列', () => {
      expect(PROJECT_RULES_CANDIDATES).toEqual([
        'CLAUDE.md',
        'PROJECT.md',
        '.wasteland/rules.md',
        '.wasteland/CLAUDE.md',
      ]);
    });

    it('多个候选文件同时存在时，优先加载 CLAUDE.md', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Claude Rules\nFollow strict rules.');
      await writeFile(join(tempDir, 'PROJECT.md'), '# Project Rules\nFallback rules.');
      await mkdir(join(tempDir, '.wasteland'), { recursive: true });
      await writeFile(join(tempDir, '.wasteland', 'rules.md'), '# Wasteland Rules');

      const result = detectProjectRules(tempDir);
      expect(result.found).toBe(true);
      expect(result.filePath).toBe(join(tempDir, 'CLAUDE.md'));
      expect(result.content).toBe('# Claude Rules\nFollow strict rules.');
    });

    it('CLAUDE.md 不存在时，按序回退至 PROJECT.md', async () => {
      await writeFile(join(tempDir, 'PROJECT.md'), '# Project Specifications');
      await mkdir(join(tempDir, '.wasteland'), { recursive: true });
      await writeFile(join(tempDir, '.wasteland', 'rules.md'), '# Wasteland Rules');

      const result = detectProjectRules(tempDir);
      expect(result.found).toBe(true);
      expect(result.filePath).toBe(join(tempDir, 'PROJECT.md'));
      expect(result.content).toBe('# Project Specifications');
    });

    it('CLAUDE.md 与 PROJECT.md 均不存在时，回退至 .wasteland/rules.md', async () => {
      await mkdir(join(tempDir, '.wasteland'), { recursive: true });
      await writeFile(join(tempDir, '.wasteland', 'rules.md'), '# Internal Wasteland Rules');

      const result = detectProjectRules(tempDir);
      expect(result.found).toBe(true);
      expect(result.filePath).toBe(join(tempDir, '.wasteland', 'rules.md'));
      expect(result.content).toBe('# Internal Wasteland Rules');
    });

    it('仅存在 .wasteland/CLAUDE.md 时，可成功探测并加载', async () => {
      await mkdir(join(tempDir, '.wasteland'), { recursive: true });
      await writeFile(join(tempDir, '.wasteland', 'CLAUDE.md'), '# Wasteland Claude Fallback');

      const result = detectProjectRules(tempDir);
      expect(result.found).toBe(true);
      expect(result.filePath).toBe(join(tempDir, '.wasteland', 'CLAUDE.md'));
      expect(result.content).toBe('# Wasteland Claude Fallback');
    });

    it('规则内容读取时自动去除两端空白', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '  \n\n# Trimmed Content\nLine 2\n\n  ');

      const result = detectProjectRules(tempDir);
      expect(result.found).toBe(true);
      expect(result.content).toBe('# Trimmed Content\nLine 2');
    });

    it('规则文件超长时正确截断并追加提示', async () => {
      const longRules = 'A'.repeat(MAX_PROJECT_RULES_LENGTH + 500);
      await writeFile(join(tempDir, 'CLAUDE.md'), longRules);

      const result = detectProjectRules(tempDir);
      expect(result.found).toBe(true);
      expect(result.content).toHaveLength(MAX_PROJECT_RULES_LENGTH + RULES_TRUNCATION_NOTICE.length);
      expect(result.content?.startsWith('A'.repeat(MAX_PROJECT_RULES_LENGTH))).toBe(true);
      expect(result.content).toContain('[Project rules truncated: exceeded 15000 characters]');
    });

    it('无规则文件时安全返回 { found: false }', () => {
      const result = detectProjectRules(tempDir);
      expect(result.found).toBe(false);
      expect(result.filePath).toBeUndefined();
      expect(result.content).toBeUndefined();
    });

    it('路径为空或无效目录时安全返回 { found: false }', () => {
      expect(detectProjectRules('')).toEqual({ found: false });
      expect(detectProjectRules('/path/to/nonexistent/workspace/dir/xyz')).toEqual({ found: false });
    });

    it('当候选名称为目录时平滑跳过', async () => {
      await mkdir(join(tempDir, 'CLAUDE.md'));
      await writeFile(join(tempDir, 'PROJECT.md'), '# Fallback From Dir');

      const result = detectProjectRules(tempDir);
      expect(result.found).toBe(true);
      expect(result.filePath).toBe(join(tempDir, 'PROJECT.md'));
      expect(result.content).toBe('# Fallback From Dir');
    });
  });

  describe('getProjectRulesSection 段落生成', () => {
    it('探测到规则文件时返回规范的 PromptSection', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '# Project Architecture Constraints');

      const section = getProjectRulesSection(tempDir);
      expect(section).not.toBeNull();
      expect(section?.id).toBe('project-rules');
      expect(section?.content).toBe('# Project Architecture Constraints');
      expect(section?.order).toBe(5);
    });

    it('无规则文件时安全返回 null', () => {
      const section = getProjectRulesSection(tempDir);
      expect(section).toBeNull();
    });

    it('规则文件为空白字符时安全返回 null', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), '   \n\t  \n  ');

      const section = getProjectRulesSection(tempDir);
      expect(section).toBeNull();
    });
  });

  describe('PromptAssembler 自动装配集成测试', () => {
    it('工作区存在规则时，assemble 自动将 Project Rules 作为前置段落注入', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), 'Must use strict TypeScript.');

      const template: PromptTemplate = {
        name: 'test-template',
        sections: [
          { id: 'goal', content: 'Complete user requirements.', order: 20 },
          { id: 'workflow', content: 'Follow red-green-refactor.', order: 30 },
        ],
      };

      const assembler = new PromptAssembler({ cwd: tempDir });
      const result = assembler.assemble(template, { cwd: tempDir, variables: {} });

      expect(result.includedSections).toEqual(['project-rules', 'goal', 'workflow']);
      expect(result.content).toContain('## Project Rules\nMust use strict TypeScript.');
      expect(result.content).toContain('## Goal\nComplete user requirements.');

      // 验证 order: 5 使得 Project Rules 排在 Goal 之前
      const rulesPos = result.content.indexOf('## Project Rules');
      const goalPos = result.content.indexOf('## Goal');
      expect(rulesPos).toBeGreaterThan(-1);
      expect(goalPos).toBeGreaterThan(rulesPos);
    });

    it('XML 格式下正确生成 <project-rules> 节点', async () => {
      await writeFile(join(tempDir, 'PROJECT.md'), 'Security first.');

      const template: PromptTemplate = {
        name: 'xml-template',
        sections: [{ id: 'main', content: 'Main prompt text.', order: 10 }],
      };

      const assembler = new PromptAssembler({ cwd: tempDir });
      const result = assembler.assemble(template, { cwd: tempDir, variables: {} }, 'xml');

      expect(result.includedSections).toEqual(['project-rules', 'main']);
      expect(result.content).toContain('<project-rules>\nSecurity first.\n</project-rules>');
    });

    it('当模板显式定义了 project-rules 时，不会重复添加', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), 'External rules.');

      const template: PromptTemplate = {
        name: 'explicit-template',
        sections: [
          { id: 'project-rules', content: 'Overridden custom rules.', order: 5 },
          { id: 'main', content: 'Task instructions.', order: 10 },
        ],
      };

      const assembler = new PromptAssembler({ cwd: tempDir });
      const result = assembler.assemble(template, { cwd: tempDir, variables: {} });

      expect(result.includedSections).toEqual(['project-rules', 'main']);
      expect(result.content).toContain('Overridden custom rules.');
      expect(result.content).not.toContain('External rules.');
    });

    it('工作区无规则时正常组装，不额外添加 project-rules', () => {
      const template: PromptTemplate = {
        name: 'clean-template',
        sections: [{ id: 'goal', content: 'Just do the task.', order: 10 }],
      };

      const assembler = new PromptAssembler({ cwd: tempDir });
      const result = assembler.assemble(template, { cwd: tempDir, variables: {} });

      expect(result.includedSections).toEqual(['goal']);
      expect(result.content).not.toContain('Project Rules');
    });

    it('assemblePrompt 便捷函数正常装配项目规则', async () => {
      await writeFile(join(tempDir, 'CLAUDE.md'), 'TDD is required.');

      const output = assemblePrompt(
        {
          name: 'convenience-template',
          sections: [{ id: 'task', content: 'Implement feature X.', order: 10 }],
        },
        { cwd: tempDir, variables: {} }
      );

      expect(output).toContain('## Project Rules\nTDD is required.');
      expect(output).toContain('## Task\nImplement feature X.');
    });
  });
});
