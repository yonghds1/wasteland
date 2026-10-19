/**
 * symbol-patterns.ts - 多语言符号精准定位正则模式构建器
 *
 * 为 TypeScript/JavaScript、Python、Go、Rust 等主流开发语言
 * 构建顶层符号定义（函数、类、接口、类型/结构体）的正则表达式模式。
 * 兼容标准 JavaScript RegExp、ripgrep 以及 git-grep (-E)。
 */

export type SymbolKind = 'all' | 'function' | 'class' | 'interface' | 'type';

/**
 * 安全转义符号名中的特殊正则元字符（如 $、.、*、+、?、^、{、}、(、)、|、[、]、\\ 等）
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 根据符号结尾字符确定边界匹配
 * 若结尾为单词字符（[a-zA-Z0-9_]），使用单词边界 \\b；否则使用非单词字符边界
 */
function getSymbolBoundary(name: string): string {
  return /[a-zA-Z0-9_]$/.test(name) ? '\\b' : '([^a-zA-Z0-9_]|$)';
}

/**
 * 构造函数/方法符号定义的匹配模式
 *
 * 支持语言：
 * - TypeScript / JavaScript:
 *   - `function <name>`, `export default function <name>`, `async function <name>`
 *   - `const <name> = (async)? (...) =>`, `let <name> = ...`, `var <name> = ...`
 *   - `async <name>(...)`
 * - Python:
 *   - `def <name>(`, `async def <name>(`
 * - Go:
 *   - `func <name>(`, `func (...) <name>(`
 * - Rust:
 *   - `fn <name>(`, `pub fn <name>(`, `pub(crate) async fn <name>(`
 */
function getFunctionPatterns(name: string): string[] {
  const n = escapeRegex(name);
  const b = getSymbolBoundary(name);

  return [
    // TS/JS: function / async function / generator
    `^\\s*(export\\s+(default\\s+)?)?(async\\s+)?function\\s*\\*?\\s*${n}${b}`,
    // TS/JS: arrow function assignment: const foo = (async)? (...) =>
    `^\\s*(export\\s+)?(const|let|var)\\s+${n}\\s*=\\s*(async\\s*)?(\\([^)]*\\)|[a-zA-Z0-9_$]+|\\<[^>]*\\>\\s*\\([^)]*\\))\\s*(:[^=]+)?=>`,
    // TS/JS: async method: async <name>(...)
    `^\\s*(public\\s+|private\\s+|protected\\s+|static\\s+)*(async\\s+)+${n}\\s*\\(`,
    // Python: def / async def
    `^\\s*(async\\s+)?def\\s+${n}\\s*\\(`,
    // Go: func <name>( or func (recv) <name>(
    `^\\s*func\\s+(\\([^)]+\\)\\s+)?${n}\\s*[\\(<]`,
    // Rust: fn / pub fn / async fn
    `^\\s*(pub(\\([^)]+\\))?\\s+)?(async\\s+)?fn\\s+${n}\\s*[\\(<]`,
  ];
}

/**
 * 构造类符号定义的匹配模式
 *
 * 支持语言：
 * - TypeScript / JavaScript:
 *   - `class <name>`, `abstract class <name>`, `export default class <name>`
 * - Python:
 *   - `class <name>(`, `class <name>:`
 */
function getClassPatterns(name: string): string[] {
  const n = escapeRegex(name);
  const b = getSymbolBoundary(name);

  return [
    // TS/JS: class / abstract class
    `^\\s*(export\\s+(default\\s+)?)?(abstract\\s+)?class\\s+${n}${b}`,
    // Python: class <name>( or class <name>:
    `^\\s*class\\s+${n}\\s*(\\(|:)`,
  ];
}

/**
 * 构造接口符号定义的匹配模式
 *
 * 支持语言：
 * - TypeScript / JavaScript:
 *   - `interface <name>`
 * - Go:
 *   - `type <name> interface`
 * - Rust:
 *   - `trait <name>`, `pub trait <name>`
 */
function getInterfacePatterns(name: string): string[] {
  const n = escapeRegex(name);
  const b = getSymbolBoundary(name);

  return [
    // TS/JS: interface
    `^\\s*(export\\s+)?interface\\s+${n}${b}`,
    // Go: type <name> interface
    `^\\s*type\\s+${n}\\s+interface${b}`,
    // Rust: trait <name>
    `^\\s*(pub(\\([^)]+\\))?\\s+)?trait\\s+${n}${b}`,
  ];
}

/**
 * 构造类型/结构体符号定义的匹配模式
 *
 * 支持语言：
 * - TypeScript / JavaScript:
 *   - `type <name> =`
 * - Go:
 *   - `type <name> struct`, `type <name> interface`, `type <name> ...`
 * - Rust:
 *   - `struct <name>`, `enum <name>`, `trait <name>`, `type <name>`
 */
function getTypePatterns(name: string): string[] {
  const n = escapeRegex(name);
  const b = getSymbolBoundary(name);

  return [
    // TS/JS: type <name> =
    `^\\s*(export\\s+)?type\\s+${n}${b}\\s*=`,
    // Go: type <name> struct / interface / custom
    `^\\s*type\\s+${n}\\s+(struct|interface|[a-zA-Z0-9_\\[\\]*])`,
    // Rust: struct, enum, trait, type
    `^\\s*(pub(\\([^)]+\\))?\\s+)?(struct|enum|trait|type)\\s+${n}${b}`,
  ];
}

/**
 * 根据符号名与可选分类构造复合正则表达式
 *
 * @param name - 目标符号名称（自动安全转义）
 * @param kind - 符号类型过滤（'all' | 'function' | 'class' | 'interface' | 'type'）
 * @returns 复合正则表达式字符串
 */
export function buildSymbolRegex(name: string, kind?: string): string {
  const normalizedKind = (kind?.toLowerCase() ?? 'all') as SymbolKind;

  let patterns: string[];
  switch (normalizedKind) {
    case 'function':
      patterns = getFunctionPatterns(name);
      break;
    case 'class':
      patterns = getClassPatterns(name);
      break;
    case 'interface':
      patterns = getInterfacePatterns(name);
      break;
    case 'type':
      patterns = getTypePatterns(name);
      break;
    case 'all':
    default:
      patterns = [
        ...getFunctionPatterns(name),
        ...getClassPatterns(name),
        ...getInterfacePatterns(name),
        ...getTypePatterns(name),
      ];
      break;
  }

  // 去重并在各子模式外包裹括号形成复合分支
  const uniquePatterns = Array.from(new Set(patterns));
  return uniquePatterns.map((p) => `(${p})`).join('|');
}
