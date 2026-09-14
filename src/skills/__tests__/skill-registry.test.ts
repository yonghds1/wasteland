import { describe, it, expect } from 'vitest';
import { SkillRegistry } from '../skill-registry.js';
import type { Skill, SkillSource, SkillDefinition } from '../skill-types.js';

function makeSkill(overrides: Partial<SkillDefinition> = {}): Skill {
  return {
    definition: {
      name: 'test-skill',
      description: 'A test skill',
      riskLevel: 'read',
      category: 'utility',
      ...overrides,
    },
    execute: async () => ({ status: 'success', output: 'done' }),
  };
}

function makeSource(type: SkillSource['type'] = 'builtin'): SkillSource {
  return { type, path: `/skills/${type}` };
}

describe('SkillRegistry', () => {
  it('empty registry', () => {
    const reg = new SkillRegistry();
    expect(reg.size).toBe(0);
    expect(reg.list()).toEqual([]);
  });

  it('register and get by name', () => {
    const reg = new SkillRegistry();
    const skill = makeSkill({ name: 'hello' });
    reg.register(skill, makeSource());

    const found = reg.get('hello');
    expect(found).toBeDefined();
    expect(found?.skill.definition.name).toBe('hello');
  });

  it('get by alias', () => {
    const reg = new SkillRegistry();
    const skill = makeSkill({ name: 'init', aliases: ['i'] });
    reg.register(skill, makeSource());

    expect(reg.get('i')).toBeDefined();
    expect(reg.get('i')?.skill.definition.name).toBe('init');
  });

  it('get returns undefined for unknown', () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill({ name: 'a' }), makeSource());
    expect(reg.get('nonexistent')).toBeUndefined();
  });

  it('overwriting a name', () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill({ name: 'x', description: 'first' }), makeSource());
    reg.register(makeSkill({ name: 'x', description: 'second' }), makeSource());

    expect(reg.size).toBe(1);
    expect(reg.get('x')?.skill.definition.description).toBe('second');
  });

  it('list returns all definitions', () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill({ name: 'a' }), makeSource());
    reg.register(makeSkill({ name: 'b' }), makeSource());

    expect(reg.list()).toHaveLength(2);
  });

  it('list filtered by category', () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill({ name: 'a', category: 'utility' }), makeSource());
    reg.register(makeSkill({ name: 'b', category: 'devops' }), makeSource());

    const utility = reg.list({ category: 'utility' });
    expect(utility).toHaveLength(1);
    expect(utility[0].name).toBe('a');
  });

  it('list filtered by source type', () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill({ name: 'a' }), makeSource('builtin'));
    reg.register(makeSkill({ name: 'b' }), makeSource('project'));

    const builtins = reg.list({ source: 'builtin' });
    expect(builtins).toHaveLength(1);
    expect(builtins[0].name).toBe('a');
  });

  it('isSkillCommand with registered name', () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill({ name: 'help' }), makeSource());
    expect(reg.isSkillCommand('/help')).toBe(true);
  });

  it('isSkillCommand with arguments', () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill({ name: 'init' }), makeSource());
    expect(reg.isSkillCommand('/init --force')).toBe(true);
  });

  it('isSkillCommand with unknown name', () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill({ name: 'help' }), makeSource());
    expect(reg.isSkillCommand('/unknown')).toBe(false);
  });

  it('isSkillCommand without leading slash', () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill({ name: 'help' }), makeSource());
    expect(reg.isSkillCommand('help')).toBe(false);
  });

  it('isSkillCommand with just slash', () => {
    const reg = new SkillRegistry();
    expect(reg.isSkillCommand('/')).toBe(false);
  });

  it('getAllNames includes aliases', () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill({ name: 'init', aliases: ['i'] }), makeSource());
    reg.register(makeSkill({ name: 'help', aliases: ['h', 'hel'] }), makeSource());

    const names = reg.getAllNames();
    expect(names).toContain('init');
    expect(names).toContain('i');
    expect(names).toContain('help');
    expect(names).toContain('h');
    expect(names).toContain('hel');
  });

  it('size excludes aliases', () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill({ name: 'init', aliases: ['i'] }), makeSource());
    reg.register(makeSkill({ name: 'help', aliases: ['h'] }), makeSource());
    expect(reg.size).toBe(2);
  });
});
