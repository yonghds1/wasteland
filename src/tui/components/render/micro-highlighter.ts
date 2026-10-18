/**
 * MicroHighlighter - 针对终端优化的轻量语法高亮器
 *
 * 专为 TUI 设计，零沉重依赖，毫秒级分词。
 * 支持语言：typescript / javascript, json, bash / sh, python, diff / patch
 */

export interface HighlightToken {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  italic?: boolean;
}

export type HighlightLine = HighlightToken[];

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'import', 'export', 'from', 'default',
  'if', 'else', 'switch', 'case', 'break', 'for', 'while', 'do', 'continue',
  'class', 'extends', 'interface', 'type', 'enum', 'implements', 'new', 'this',
  'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof',
  'null', 'undefined', 'true', 'false', 'void', 'as', 'readonly',
]);

const PY_KEYWORDS = new Set([
  'def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else',
  'for', 'while', 'break', 'continue', 'try', 'except', 'finally', 'raise',
  'with', 'as', 'lambda', 'yield', 'pass', 'None', 'True', 'False',
  'async', 'await', 'is', 'in', 'not', 'and', 'or',
]);

const SH_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done',
  'while', 'until', 'case', 'esac', 'function', 'return', 'exit', 'export',
  'echo', 'source', 'set', 'local',
]);

/**
 * 将单行文本基于指定语言分词为 HighlightToken 数组
 */
export function highlightLine(rawLine: string, lang = ''): HighlightLine {
  const normLang = lang.toLowerCase().trim();
  if (!rawLine) {
    return [{ text: ' ' }];
  }

  // 1. Diff / Patch 特殊处理
  if (normLang === 'diff' || normLang === 'patch') {
    if (rawLine.startsWith('+')) {
      return [{ text: rawLine, color: 'green' }];
    }
    if (rawLine.startsWith('-')) {
      return [{ text: rawLine, color: 'red' }];
    }
    if (rawLine.startsWith('@@')) {
      return [{ text: rawLine, color: 'cyan', dim: true }];
    }
    if (rawLine.startsWith('---') || rawLine.startsWith('+++')) {
      return [{ text: rawLine, bold: true, color: 'yellow' }];
    }
    return [{ text: rawLine, dim: true }];
  }

  // 2. 选择关键词集合
  let keywords = JS_KEYWORDS;
  let commentPrefix = '//';
  if (normLang === 'py' || normLang === 'python') {
    keywords = PY_KEYWORDS;
    commentPrefix = '#';
  } else if (normLang === 'sh' || normLang === 'bash' || normLang === 'zsh') {
    keywords = SH_KEYWORDS;
    commentPrefix = '#';
  } else if (normLang === 'json') {
    keywords = new Set(['true', 'false', 'null']);
    commentPrefix = '';
  }

  const tokens: HighlightToken[] = [];
  let i = 0;
  const len = rawLine.length;

  while (i < len) {
    // 检查注释
    if (commentPrefix && rawLine.startsWith(commentPrefix, i)) {
      tokens.push({ text: rawLine.slice(i), color: 'gray', italic: true, dim: true });
      break;
    }

    const ch = rawLine[i];

    // 检查字符串
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      let escaped = false;
      while (j < len) {
        if (rawLine[j] === '\\' && !escaped) {
          escaped = true;
          j++;
          continue;
        }
        if (rawLine[j] === quote && !escaped) {
          j++;
          break;
        }
        escaped = false;
        j++;
      }
      tokens.push({ text: rawLine.slice(i, j), color: 'green' });
      i = j;
      continue;
    }

    // 检查数字
    if (/\d/.test(ch)) {
      let j = i;
      while (j < len && /[\d.a-fA-Fx]/.test(rawLine[j])) {
        j++;
      }
      tokens.push({ text: rawLine.slice(i, j), color: 'yellow' });
      i = j;
      continue;
    }

    // 检查标识符 / 关键词
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i;
      while (j < len && /[a-zA-Z0-9_$-]/.test(rawLine[j])) {
        j++;
      }
      const word = rawLine.slice(i, j);
      if (keywords.has(word)) {
        tokens.push({ text: word, color: 'cyan', bold: true });
      } else if (word[0] >= 'A' && word[0] <= 'Z') {
        // 类型或类名首字母大写
        tokens.push({ text: word, color: 'blue', bold: true });
      } else {
        tokens.push({ text: word });
      }
      i = j;
      continue;
    }

    // 标点符号与空白
    tokens.push({ text: ch, dim: ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === ';' });
    i++;
  }

  return tokens.length > 0 ? tokens : [{ text: ' ' }];
}

/**
 * 高亮整个代码段，返回每行 HighlightToken 数组
 */
export function highlightCode(code: string, lang = ''): HighlightLine[] {
  const lines = code.split('\n');
  return lines.map((line) => highlightLine(line, lang));
}
