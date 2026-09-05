import { describe, it, expect } from 'vitest';
import {
  parseSkillArgs,
  validateSkillArgs,
  applyDefaults,
  generateArgsHelp,
} from './skill-parser.js';
import type { SkillDefinition } from './skill-types.js';

describe('parseSkillArgs', () => {
  it('empty string', () => {
    const result = parseSkillArgs('');
    expect(result.positional).toEqual([]);
    expect(result.named).toEqual({});
    expect(result.raw).toBe('');
  });

  it('just skill name', () => {
    const result = parseSkillArgs('/init');
    expect(result.positional).toEqual([]);
    expect(result.named).toEqual({});
  });

  it('single positional arg', () => {
    const result = parseSkillArgs('/review staged');
    expect(result.positional).toEqual(['staged']);
  });

  it('multiple positional args', () => {
    const result = parseSkillArgs('/run a b c');
    expect(result.positional).toEqual(['a', 'b', 'c']);
  });

  it('named string param', () => {
    const result = parseSkillArgs('/init --template minimal');
    expect(result.named).toEqual({ template: 'minimal' });
  });

  it('named numeric param', () => {
    const result = parseSkillArgs('/set --count 5');
    expect(result.named).toEqual({ count: 5 });
  });

  it('named boolean flag', () => {
    const result = parseSkillArgs('/test --watch --coverage');
    expect(result.named).toEqual({ watch: true, coverage: true });
  });

  it('comma-separated array', () => {
    const result = parseSkillArgs('/deploy --items a,b,c');
    expect(result.named).toEqual({ items: ['a', 'b', 'c'] });
  });

  it('double-quoted string', () => {
    const result = parseSkillArgs('/say "hello world"');
    expect(result.positional).toEqual(['hello world']);
  });

  it('single-quoted string', () => {
    const result = parseSkillArgs("/say 'hello world'");
    expect(result.positional).toEqual(['hello world']);
  });

  it('mixed positional and named', () => {
    const result = parseSkillArgs('/review staged --format full');
    expect(result.positional).toEqual(['staged']);
    expect(result.named).toEqual({ format: 'full' });
  });

  it('raw preserves original input', () => {
    const input = '/test --flag value';
    const result = parseSkillArgs(input);
    expect(result.raw).toBe(input);
  });
});

describe('validateSkillArgs', () => {
  const baseDef: SkillDefinition = {
    name: 'test',
    description: 'test skill',
    riskLevel: 'read',
    parameters: {
      target: { type: 'string', required: true, description: 'target' },
      count: { type: 'number', required: false, description: 'count' },
    },
  };

  it('all required params present', () => {
    const result = validateSkillArgs(
      { positional: ['staged'], named: {}, raw: '/test staged' },
      baseDef
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('missing required param', () => {
    const result = validateSkillArgs(
      { positional: [], named: {}, raw: '/test' },
      baseDef
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('required string satisfied by named param', () => {
    const result = validateSkillArgs(
      { positional: [], named: { target: 'staged' }, raw: '/test --target staged' },
      baseDef
    );
    expect(result.valid).toBe(true);
  });

  it('type mismatch: number param gets string', () => {
    const result = validateSkillArgs(
      { positional: ['file'], named: { count: 'abc' }, raw: '/test file --count abc' },
      baseDef
    );
    expect(result.valid).toBe(false);
  });

  it('enum constraint satisfied', () => {
    const def: SkillDefinition = {
      ...baseDef,
      parameters: {
        format: { type: 'string', required: false, description: 'fmt', enum: ['json', 'text'] },
      },
    };
    const result = validateSkillArgs(
      { positional: [], named: { format: 'json' }, raw: '/test --format json' },
      def
    );
    expect(result.valid).toBe(true);
  });

  it('enum constraint violated', () => {
    const def: SkillDefinition = {
      ...baseDef,
      parameters: {
        format: { type: 'string', required: false, description: 'fmt', enum: ['json', 'text'] },
      },
    };
    const result = validateSkillArgs(
      { positional: [], named: { format: 'xml' }, raw: '/test --format xml' },
      def
    );
    expect(result.valid).toBe(false);
  });

  it('no parameters definition always valid', () => {
    const def: SkillDefinition = { name: 'test', description: 'test', riskLevel: 'read' };
    const result = validateSkillArgs(
      { positional: ['anything'], named: { whatever: true }, raw: '/test anything --whatever' },
      def
    );
    expect(result.valid).toBe(true);
  });
});

describe('applyDefaults', () => {
  it('fills in missing defaults', () => {
    const def: SkillDefinition = {
      name: 'test',
      description: 'test',
      riskLevel: 'read',
      parameters: {
        mode: { type: 'string', required: false, description: 'mode', default: 'auto' },
      },
    };
    const result = applyDefaults(
      { positional: [], named: {}, raw: '/test' },
      def
    );
    expect(result.named.mode).toBe('auto');
  });

  it('does not overwrite existing values', () => {
    const def: SkillDefinition = {
      name: 'test',
      description: 'test',
      riskLevel: 'read',
      parameters: {
        mode: { type: 'string', required: false, description: 'mode', default: 'auto' },
      },
    };
    const result = applyDefaults(
      { positional: [], named: { mode: 'manual' }, raw: '/test --mode manual' },
      def
    );
    expect(result.named.mode).toBe('manual');
  });
});

describe('generateArgsHelp', () => {
  it('no parameters', () => {
    const def: SkillDefinition = { name: 'test', description: 'test', riskLevel: 'read' };
    const help = generateArgsHelp(def);
    // 返回 i18n key 或本地化文本
    expect(help.length).toBeGreaterThan(0);
  });

  it('required param with description', () => {
    const def: SkillDefinition = {
      name: 'test',
      description: 'test',
      riskLevel: 'read',
      parameters: {
        target: { type: 'string', required: true, description: 'build target' },
      },
    };
    const help = generateArgsHelp(def);
    expect(help).toContain('target');
    expect(help).toContain('build target');
  });

  it('param with default', () => {
    const def: SkillDefinition = {
      name: 'test',
      description: 'test',
      riskLevel: 'read',
      parameters: {
        format: { type: 'string', required: false, description: 'output format', default: 'json' },
      },
    };
    const help = generateArgsHelp(def);
    expect(help).toContain('json');
  });
});
