/**
 * markdown-splitter - 将 Markdown 文本流拆解为结构化渲染块
 */

export type MarkdownBlockType = 'text' | 'code' | 'diff';

export interface CodeBlockData {
  lang: string;
  filename?: string;
  code: string;
}

export interface MarkdownBlock {
  type: MarkdownBlockType;
  content: string;
  codeData?: CodeBlockData;
}

/**
 * 解析代码块首行元数据，如 ```ts:src/app.ts 或 ```json
 */
function parseCodeFenceMeta(info: string): { lang: string; filename?: string } {
  const trimmed = info.trim();
  if (!trimmed) return { lang: 'text' };

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    return {
      lang: parts[0]?.trim() || 'text',
      filename: parts[1]?.trim(),
    };
  }

  const spaceParts = trimmed.split(/\s+/);
  const lang = spaceParts[0] || 'text';
  let filename: string | undefined;

  for (let i = 1; i < spaceParts.length; i++) {
    const p = spaceParts[i];
    if (p && p.startsWith('title=')) {
      filename = p.replace(/^title=["']?/, '').replace(/["']?$/, '');
      break;
    }
  }

  return { lang, filename };
}

/**
 * 将整段 Markdown 字符串切片为连续的渲染块列表
 */
export function splitMarkdownBlocks(rawMarkdown: string): MarkdownBlock[] {
  if (!rawMarkdown) return [];

  const blocks: MarkdownBlock[] = [];
  const lines = rawMarkdown.split('\n');
  let inCodeBlock = false;
  let codeFenceLang = 'text';
  let codeFenceFile: string | undefined;
  let currentCodeLines: string[] = [];
  let currentTextLines: string[] = [];

  const flushText = () => {
    if (currentTextLines.length > 0) {
      const content = currentTextLines.join('\n');
      if (content.trim().length > 0) {
        blocks.push({ type: 'text', content });
      }
      currentTextLines = [];
    }
  };

  const flushCode = () => {
    const code = currentCodeLines.join('\n');
    const isDiff = codeFenceLang === 'diff' || codeFenceLang === 'patch';
    blocks.push({
      type: isDiff ? 'diff' : 'code',
      content: code,
      codeData: {
        lang: codeFenceLang,
        filename: codeFenceFile,
        code,
      },
    });
    currentCodeLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        // 进入代码块
        flushText();
        inCodeBlock = true;
        const meta = parseCodeFenceMeta(trimmed.slice(3));
        codeFenceLang = meta.lang;
        codeFenceFile = meta.filename;
      } else {
        // 离开代码块
        flushCode();
        inCodeBlock = false;
        codeFenceLang = 'text';
        codeFenceFile = undefined;
      }
    } else if (inCodeBlock) {
      currentCodeLines.push(line);
    } else {
      currentTextLines.push(line);
    }
  }

  // 兜底未闭合代码块
  if (inCodeBlock && currentCodeLines.length > 0) {
    flushCode();
  } else {
    flushText();
  }

  return blocks;
}
