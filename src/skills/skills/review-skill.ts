/**
 * review-skill.ts - 代码审查技能
 *
 * 通过 git diff 获取变更文件，读取内容并检查常见代码质量问题：
 * - TODO / FIXME 注释
 * - console.log 调用
 * - @ts-ignore / @ts-expect-error
 * - 空 catch 块
 * - 超长文件（>500 行）
 *
 * 若 provider 可用，可调用 LLM 进行更深入的语义分析。
 */

import { t } from '@locales/index.js';
import type { Skill, SkillArgs, SkillExecutionContext, SkillResult } from '../skill-types.js';
import { createTurnContext } from '@core/runtime/turn-context.js';
import { createInitialTurnState } from '@core/engine/turn-state.js';

/** 审查发现项 */
interface ReviewFinding {
  file: string;
  line: number;
  category: string;
  message: string;
}

/** 模式检查规则 */
interface PatternRule {
  name: string;
  pattern: RegExp;
  message: string;
}

/**
 * 确定性模式检查规则列表
 */
const PATTERN_RULES: PatternRule[] = [
  {
    name: 'todo',
    pattern: /\b(TODO|FIXME|HACK|XXX)\b/,
    message: '代码审查: 待处理标记',
  },
  {
    name: 'console',
    pattern: /\bconsole\.(log|debug|info)\b/,
    message: '代码审查: 残留的 console 调用',
  },
  {
    name: 'ts-ignore',
    pattern: /@ts-ignore|@ts-expect-error/,
    message: '代码审查: TypeScript 错误抑制',
  },
  {
    name: 'empty-catch',
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
    message: '代码审查: 空 catch 块',
  },
  {
    name: 'magic-number',
    pattern: /\b(?:0x[0-9a-fA-F]{4,}|(?:[2-9]\d{2,}))\b/,
    message: '代码审查: 可能的魔数（建议提取为常量）',
  },
];

/** 单文件最大行数警告阈值 */
const FILE_LINE_THRESHOLD = 500;

/**
 * 调用 LLM 进行语义分析
 *
 * @param context - 技能执行上下文
 * @param codeChanges - 代码变更内容
 * @returns LLM 分析结果
 */
async function callLlmForAnalysis(
  context: SkillExecutionContext,
  codeChanges: string
): Promise<string> {
  if (!context.provider) {
    return t('skills.review.llmNotAvailable');
  }

  const prompt = `你是一个代码审查专家。请分析以下代码变更，指出潜在的问题、改进建议和最佳实践。

重点关注：
1. 逻辑错误或潜在 bug
2. 性能问题
3. 安全漏洞
4. 代码可读性和维护性
5. 命名规范
6. 错误处理
7. 类型安全

请用中文回答，格式清晰，按严重程度排序。

代码变更：
${codeChanges}`;

  try {
    const turnContext = createTurnContext({
      sessionId: context.sessionId,
      input: {
        content: prompt,
        turn: context.turn,
        source: 'interactive',
      },
      cwd: context.cwd,
      history: [],
      toolRegistry: context.toolRegistry,
    });

    const turnState = createInitialTurnState({
      sessionId: context.sessionId,
      input: turnContext.input,
      cwd: context.cwd,
      history: [],
    });

    const observable = context.provider.runStep({
      context: turnContext,
      state: turnState,
    });

    // 收集所有事件，拼接 assistant_chunk 和 assistant_message 的文本
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      observable.subscribe({
        next: (event) => {
          if (event.type === 'assistant_chunk' || event.type === 'assistant_message') {
            chunks.push(event.text);
          }
        },
        error: reject,
        complete: resolve,
      });
    });

    const result = chunks.join('');
    return result || t('skills.review.llmNoResponse');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `${t('skills.review.llmError')}: ${errorMessage}`;
  }
}

/**
 * 通过 bash 工具执行命令
 */
async function runBash(
  context: SkillExecutionContext,
  command: string
): Promise<{ ok: boolean; output: string }> {
  const bashTool = context.toolRegistry.get('bash');
  if (!bashTool) return { ok: false, output: '' };
  const result = await bashTool.execute(
    { command },
    { sessionId: context.sessionId, turn: context.turn, cwd: context.cwd }
  );
  const ok = result.status === 'success';
  return { ok, output: ok ? result.output : '' };
}

/**
 * 通过 read-file 工具读取文件内容
 */
async function readFile(
  context: SkillExecutionContext,
  filePath: string
): Promise<string | null> {
  const readTool = context.toolRegistry.get('read-file');
  if (!readTool) return null;
  const result = await readTool.execute(
    { path: filePath },
    { sessionId: context.sessionId, turn: context.turn, cwd: context.cwd }
  );
  if (result.status !== 'success') return null;
  // result is narrowed to ToolSuccessResult after status check
  return result.output;
}

/**
 * 获取变更文件列表（支持 staged / unstaged / 全部）
 */
async function getChangedFiles(
  context: SkillExecutionContext,
  mode: 'all' | 'staged' | 'unstaged'
): Promise<string[]> {
  let gitCmd: string;
  switch (mode) {
    case 'staged':
      gitCmd = 'git diff --cached --name-only --diff-filter=ACMR';
      break;
    case 'unstaged':
      gitCmd = 'git diff --name-only --diff-filter=ACMR';
      break;
    case 'all':
    default:
      gitCmd = 'git diff --name-only --diff-filter=ACMR HEAD 2>/dev/null; git diff --cached --name-only --diff-filter=ACMR 2>/dev/null';
      break;
  }
  const { ok, output } = await runBash(context, gitCmd);
  if (!ok || !output.trim()) return [];
  return [...new Set(output.split('\n').map((l) => l.trim()).filter(Boolean))];
}

/**
 * 获取 diff 内容（仅用于显示，不做解析）
 */
async function getDiffContent(
  context: SkillExecutionContext,
  filePath: string,
  mode: 'all' | 'staged' | 'unstaged'
): Promise<string> {
  let flag = '';
  switch (mode) {
    case 'staged':
      flag = '--cached';
      break;
    case 'unstaged':
      break;
    case 'all':
    default:
      flag = 'HEAD';
      break;
  }
  const { ok, output } = await runBash(context, `git diff ${flag} -- "${filePath}" 2>/dev/null`);
  return ok ? output : '';
}

/**
 * 对单个文件内容执行模式检查
 */
function checkPatterns(
  content: string,
  filePath: string
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    for (const rule of PATTERN_RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          file: filePath,
          line: i + 1,
          category: rule.name,
          message: rule.message,
        });
      }
    }
  }

  // 文件行数检查
  if (lines.length > FILE_LINE_THRESHOLD) {
    findings.push({
      file: filePath,
      line: lines.length,
      category: 'file-length',
      message: `代码审查: 文件过长 (${lines.length} 行，建议拆分)`,
    });
  }

  return findings;
}

/**
 * 将 findings 按 category 分组统计
 */
function summarizeFindings(findings: ReviewFinding[]): string {
  const byCategory = new Map<string, ReviewFinding[]>();
  for (const f of findings) {
    const existing = byCategory.get(f.category) ?? [];
    existing.push(f);
    byCategory.set(f.category, existing);
  }

  const categoryLabels: Record<string, string> = {
    todo: '📝 待处理标记 (TODO/FIXME)',
    console: '🔍 残留 console 调用',
    'ts-ignore': '⚠️ TypeScript 错误抑制',
    'empty-catch': '🕳️ 空 catch 块',
    'magic-number': '🔢 魔数',
    'file-length': '📏 文件过长',
  };

  const lines: string[] = [];
  let total = 0;

  for (const [cat, items] of byCategory) {
    const label = categoryLabels[cat] ?? cat;
    lines.push(`### ${label} (${items.length})`);
    lines.push('');
    for (const item of items.slice(0, 10)) {
      lines.push(`- \`${item.file}:${item.line}\``);
    }
    if (items.length > 10) {
      lines.push(`- ... 还有 ${items.length - 10} 处`);
    }
    lines.push('');
    total += items.length;
  }

  if (total === 0) {
    lines.push('✅ 未发现常见代码质量问题');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * /review 技能实现
 */
export const reviewSkill: Skill = {
  definition: {
    name: 'review',
    get description() { return t('skills.review.description'); },
    riskLevel: 'read',
    aliases: ['rv', 'cr'],
    category: 'code-review',
    parameters: {
      staged: {
        type: 'boolean',
        get description() { return t('skills.review.stagedDesc'); },
        default: false,
      },
      unstaged: {
        type: 'boolean',
        get description() { return t('skills.review.unstagedDesc'); },
        default: false,
      },
      file: {
        type: 'string',
        get description() { return t('skills.review.fileDesc'); },
      },
      llm: {
        type: 'boolean',
        get description() { return t('skills.review.llmDesc'); },
        default: false,
      },
    },
    examples: [
      '/review',
      '/rv',
      '/review --staged',
      '/review --file src/foo.ts',
      '/review --llm',
    ],
  },

  async execute(args: SkillArgs, context: SkillExecutionContext): Promise<SkillResult> {
    const staged = (args.named.staged as boolean) ?? false;
    const unstaged = (args.named.unstaged as boolean) ?? false;
    const file = args.named.file as string | undefined;
    const useLlm = (args.named.llm as boolean) ?? false;

    // 确定审查模式
    let mode: 'all' | 'staged' | 'unstaged' = 'all';
    if (staged) mode = 'staged';
    else if (unstaged) mode = 'unstaged';

    // 累积流式输出，最终拼入返回值
    const statusLines: string[] = [];
    const emit = (msg: string) => {
      statusLines.push(msg);
      context.output(msg);
    };

    emit(`${t('skills.review.analyzing')}\n`);

    // 1. 获取变更文件列表
    let changedFiles: string[];
    if (file) {
      changedFiles = [file];
    } else {
      changedFiles = await getChangedFiles(context, mode);
    }

    if (changedFiles.length === 0) {
      return {
        status: 'success',
        output: t('skills.review.noChanges'),
      };
    }

    emit(
      `${t('skills.review.foundFiles', { count: String(changedFiles.length) })}\n`
    );

    // 2. 读取文件并执行模式检查
    const allFindings: ReviewFinding[] = [];
    const fileSummaries: string[] = [];

    for (const filePath of changedFiles) {
      const content = await readFile(context, filePath);
      if (content === null) {
        fileSummaries.push(`- \`${filePath}\` — ${t('skills.review.cannotRead')}`);
        continue;
      }

      const findings = checkPatterns(content, filePath);
      allFindings.push(...findings);

      const findingCount = findings.length;
      const lineCount = content.split('\n').length;
      fileSummaries.push(
        `- \`${filePath}\` — ${lineCount} 行, ${findingCount} ${t('skills.review.findings')}`
      );
    }

    // 3. 构建报告
    const lines: string[] = [];

    lines.push(`# ${t('skills.review.title')}`);
    lines.push('');

    // 文件列表
    lines.push(`## ${t('skills.review.changedFiles')}`);
    lines.push('');
    lines.push(...fileSummaries);
    lines.push('');

    // 发现统计
    lines.push(`## ${t('skills.review.issues')}`);
    lines.push('');
    lines.push(summarizeFindings(allFindings));

    // 可选: LLM 增强分析
    if (useLlm) {
      lines.push(`## ${t('skills.review.llmAnalysis')}`);
      lines.push('');
      if (context.provider) {
        emit(`${t('skills.review.llmAnalyzing')}\n`);
        // 收集所有文件的 diff 内容
        const allDiffs: string[] = [];
        for (const filePath of changedFiles) {
          const diff = await getDiffContent(context, filePath, mode);
          if (diff) {
            allDiffs.push(`--- ${filePath}\n${diff}`);
          }
        }
        if (allDiffs.length > 0) {
          const llmResult = await callLlmForAnalysis(context, allDiffs.join('\n\n'));
          lines.push(llmResult);
        } else {
          lines.push(t('skills.review.llmNoChanges'));
        }
      } else {
        lines.push(t('skills.review.llmNotAvailable'));
      }
      lines.push('');
    }

    // 总结
    lines.push(`---`);
    lines.push(
      `*${t('skills.review.totalIssues', { count: String(allFindings.length) })}*`
    );

    return {
      status: 'success',
      output: [...statusLines, ...lines].join('\n'),
    };
  },
};
