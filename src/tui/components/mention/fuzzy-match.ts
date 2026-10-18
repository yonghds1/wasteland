/**
 * 模糊搜索评分算法
 * 优先级规则：
 * 1. 文件名完全包含/前缀匹配优先于目录路径匹配
 * 2. 连续字符匹配得分更高
 * 3. 驼峰首字母或分隔符（如 - _ / .）后首字母匹配得分更高
 */

export interface ScoredMatch {
  file: string;
  score: number;
}

export function scoreFileMatch(pattern: string, filePath: string): number {
  const p = pattern.toLowerCase();
  const full = filePath.toLowerCase();
  const lastSlash = filePath.lastIndexOf('/');
  const baseName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  const baseLower = baseName.toLowerCase();

  // 空搜索词：默认全匹配，按路径长度自然排序
  if (p.length === 0) {
    return 100 - Math.min(filePath.length, 50);
  }

  // 1. 文件名完全相等
  if (baseLower === p) {
    return 1000;
  }

  // 2. 文件名前缀匹配
  if (baseLower.startsWith(p)) {
    return 800 - (baseLower.length - p.length);
  }

  // 3. 文件名包含匹配
  const baseIndex = baseLower.indexOf(p);
  if (baseIndex >= 0) {
    return 600 - baseIndex * 2;
  }

  // 4. 路径前缀匹配
  if (full.startsWith(p)) {
    return 400;
  }

  // 5. 路径包含匹配
  const fullIndex = full.indexOf(p);
  if (fullIndex >= 0) {
    return 300 - fullIndex;
  }

  // 6. 模糊子序列与首字母缩写匹配（例如 cib 匹配 ChatInputBar.tsx）
  let pIdx = 0;
  let score = 0;
  let consecutive = 0;

  for (let i = 0; i < full.length && pIdx < p.length; i++) {
    if (full[i] === p[pIdx]) {
      pIdx++;
      consecutive++;
      score += 10 + consecutive * 5;

      // 如果字符紧随在分隔符之后（如 / 或 . 或 -）或处于大写边界，赋予极高加权
      if (i === 0 || full[i - 1] === '/' || full[i - 1] === '-' || full[i - 1] === '_' || full[i - 1] === '.') {
        score += 30;
      }
    } else {
      consecutive = 0;
    }
  }

  // 所有 pattern 字符必须按序出现
  if (pIdx === p.length) {
    return score;
  }

  return -1; // 不匹配
}

export function fuzzyMatchFiles(pattern: string, files: string[], limit = 6): string[] {
  const scored: ScoredMatch[] = [];

  for (const file of files) {
    const score = scoreFileMatch(pattern, file);
    if (score > 0) {
      scored.push({ file, score });
    }
  }

  // 按得分由高到低排序，得分相同按路径长度由短到长排序
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.file.length - b.file.length;
  });

  return scored.slice(0, limit).map((s) => s.file);
}
