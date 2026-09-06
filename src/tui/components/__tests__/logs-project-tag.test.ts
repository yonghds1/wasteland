import { describe, expect, it } from 'vitest';

import { projectTag } from '../LogsPage.js';

describe('projectTag', () => {
  it('本项目返回空串', () => {
    expect(projectTag('/a', 'pid', 'pid')).toBe('');
  });

  it('他项目返回 basename 标签（截断 12 列）', () => {
    expect(projectTag('/home/u/my-repo', 'other', 'pid')).toBe(' [my-repo]');
    expect(projectTag('/home/u/a-very-long-name', 'other', 'pid')).toBe(' [a-very-long…]');
  });

  it('无缓存时一律打标签', () => {
    expect(projectTag('/a', 'pid', null)).toBe(' [a]');
  });
});
