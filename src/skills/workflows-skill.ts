/**
 * workflows-skill.ts - /workflows 入口技能
 *
 * 动态工作流的 TUI 入口：无参列出运行中/已完成/中断任务；
 * `/workflows <name> <目标>` 校验并提交后台运行。
 * 确认与执行由 Workflow 工具侧完成，本 Skill 只做解析、预检展示与提交。
 */

import type {
  Skill,
  SkillArgs,
  SkillResult,
  SkillExecutionContext,
} from './skill-types.js';
import type { SessionMetadata } from '../core/session/session-manager.js';
import { t } from '../locales/index.js';

export interface WorkflowsListItem {
  name: string;
  description?: string;
  path?: string;
}

export interface WorkflowsSubmitInput {
  name: string;
  target?: string;
  args?: string[];
  session: SessionMetadata;
}

export interface WorkflowsDeps {
  list: () => Promise<WorkflowsListItem[]>;
  submit: (input: WorkflowsSubmitInput) => Promise<{ taskId: string; runId: string }>;
  query: (id: string) => Promise<unknown>;
}

let deps: WorkflowsDeps | null = null;

export function setWorkflowsDeps(next: WorkflowsDeps): void {
  deps = next;
}

export function __resetWorkflowsDepsForTest(): void {
  deps = null;
}

function fmt(tmpl: string, vars: Record<string, string>): string {
  let out = tmpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, v);
  }
  return out;
}

export const workflowsSkill: Skill = {
  definition: {
    name: 'workflows',
    get description() {
      return t('skills.workflows.description');
    },
    riskLevel: 'execute',
    category: 'system',
    parameters: {
      action: {
        type: 'string',
        description: 'list: 列出工作流; run: 提交运行',
        enum: ['list', 'run'],
      },
      name: {
        type: 'string',
        description: '工作流名称（run 必填）',
      },
      target: {
        type: 'string',
        description: '目标路径（run 可选，剩余位置参数拼接）',
      },
      yes: {
        type: 'boolean',
        description: '跳过 TUI 二次确认（不跳过 ask-user）',
        default: false,
      },
    },
    examples: ['/workflows', '/workflows list', '/workflows review ./src'],
  },

  async execute(args: SkillArgs, context: SkillExecutionContext): Promise<SkillResult> {
    if (deps === null) {
      const msg = t('skills.workflows.notInit');
      context.output(msg);
      return { status: 'error', output: msg };
    }

    const positional: string[] = Array.isArray(args.positional) ? args.positional : [];
    const named: Record<string, unknown> =
      typeof args.named === 'object' && args.named !== null
        ? (args.named as Record<string, unknown>)
        : {};

    let action: string | undefined =
      typeof named['action'] === 'string' ? (named['action'] as string) : undefined;
    if (action === undefined) {
      action = positional.length === 0 ? 'list' : 'run';
    }
    if (action !== 'list' && action !== 'run') {
      const msg = `unknown action: ${action}, expected list|run`;
      context.output(msg);
      return { status: 'error', output: msg };
    }

    if (action === 'list') {
      const items = await deps.list();
      if (items.length === 0) {
        const msg = t('skills.workflows.listEmpty');
        context.output(msg);
        return { status: 'success', output: msg, data: { items } };
      }
      const header = t('skills.workflows.listHeader');
      const lines = items.map((it) =>
        it.description ? `- ${it.name}: ${it.description}` : `- ${it.name}`,
      );
      const msg = `${header}\n${lines.join('\n')}`;
      context.output(msg);
      return { status: 'success', output: msg, data: { items } };
    }

    let name: string | undefined =
      typeof named['name'] === 'string' ? (named['name'] as string) : undefined;
    let target: string | undefined =
      typeof named['target'] === 'string' ? (named['target'] as string) : undefined;

    const rest: string[] =
      positional.length > 0 && positional[0] === 'run' ? positional.slice(1) : positional.slice(0);
    if (name === undefined && rest.length >= 1) {
      name = rest[0];
    }
    if (target === undefined) {
      const tail = name === undefined ? rest : rest.slice(1);
      const joined = tail.join(' ').trim();
      target = joined.length > 0 ? joined : undefined;
    }
    if (name === undefined || name.trim().length === 0) {
      const msg = 'missing required name for workflows run';
      context.output(msg);
      return { status: 'error', output: msg };
    }
    name = name.trim();

    context.output(`[L1预检] risk=execute action=run name=${name}${target ? ` target=${target}` : ''}`);

    try {
      const { taskId, runId } = await deps.submit({
        name,
        target,
        args: target !== undefined ? [target] : [],
        session: context.session,
      });
      const msg = fmt(t('skills.workflows.submitted'), { name, taskId, runId });
      context.output(msg);
      return { status: 'success', output: msg, data: { taskId, runId, name } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      context.output(msg);
      return { status: 'error', output: msg };
    }
  },
};
