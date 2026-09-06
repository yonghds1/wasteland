/**
 * context.ts - Context 查看命令
 *
 * 展示当前 context 使用情况、token 消耗统计。
 *
 * ## 功能
 *
 * - 查看当前 context 使用情况
 * - 查看使用历史趋势
 * - 查看压缩历史
 * - 支持多种输出格式
 * - 支持实时更新
 */

import { Command } from 'commander';
import { createContextStatsCollector, type ContextStatsCollector } from '@core/memory/context-stats.js';
import { createContextVisualizer, type OutputFormat } from '@ui/context-visualizer.js';
import { t } from '@locales/index.js';

// ============================================================
// 辅助函数
// ============================================================

/**
 * 查找当前会话的统计文件
 *
 * @returns 统计收集器
 */
async function findCurrentSessionStats(): Promise<ContextStatsCollector | null> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');

  const sessionsDir = path.join(os.homedir(), '.wasteland', 'sessions');

  try {
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true });

    // 查找最新的会话目录
    let latestSession: string | null = null;
    let latestTime = 0;

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const sessionDir = path.join(sessionsDir, entry.name);
        const statsFile = path.join(sessionDir, 'context-stats.json');

        try {
          const stat = await fs.stat(statsFile);
          if (stat.mtimeMs > latestTime) {
            latestTime = stat.mtimeMs;
            latestSession = entry.name;
          }
        } catch {
          // 文件不存在，忽略
        }
      }
    }

    if (!latestSession) {
      return null;
    }

    // 加载统计
    const collector = createContextStatsCollector(latestSession, 128000);
    await collector.load();

    return collector;
  } catch {
    return null;
  }
}

/**
 * 查找指定会话的统计文件
 *
 * @param sessionId - 会话 ID
 * @returns 统计收集器
 */
async function findSessionStats(sessionId: string): Promise<ContextStatsCollector | null> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');

  const sessionDir = path.join(os.homedir(), '.wasteland', 'sessions', sessionId);
  const statsFile = path.join(sessionDir, 'context-stats.json');

  try {
    await fs.access(statsFile);
    const collector = createContextStatsCollector(sessionId, 128000);
    await collector.load();
    return collector;
  } catch {
    return null;
  }
}

// ============================================================
// 命令定义
// ============================================================

/**
 * 创建 context 命令
 */
export function createContextCommand(): Command {
  return new Command('context')
    .description(t('commands.context.description'))
    .argument('[session-id]', t('commands.context.options.sessionId'))
    .option('-f, --format <format>', t('commands.context.options.format'), 'text')
    .option('-d, --details', t('commands.context.options.details'))
    .option('-h, --history', t('commands.context.options.history'))
    .option('--history-limit <limit>', t('commands.context.options.historyLimit'), '10')
    .option('--no-color', t('commands.context.options.color'))
    .option('-w, --watch', t('commands.context.options.watch'))
    .option('--watch-interval <seconds>', t('commands.context.options.watchInterval'), '5')
    .action(async (sessionId: string | undefined, options) => {
      try {
        // 获取统计收集器
        let collector: ContextStatsCollector | null;

        if (sessionId) {
          collector = await findSessionStats(sessionId);
        } else {
          collector = await findCurrentSessionStats();
        }

        if (!collector) {
          console.error(t('commands.context.notFound'));
          console.log(t('commands.context.noSession'));
          process.exit(1);
        }

        // 创建可视化渲染器
        const visualizer = createContextVisualizer({
          format: options.format as OutputFormat,
          enableColors: options.color !== false,
          showDetails: options.details,
          showHistory: options.history,
          historyLimit: parseInt(options.historyLimit, 10),
        });

        // 渲染统计
        const stats = collector.collectStats();
        const output = visualizer.renderStatsTable(stats);

        if (options.watch) {
          // 实时更新模式
          console.clear();
          console.log(output);

          const interval = parseInt(options.watchInterval, 10) * 1000;

          setInterval(async () => {
            if (!collector) return;
            // 重新加载统计
            await collector.load();
            const updatedStats = collector.collectStats();
            const updatedOutput = visualizer.renderStatsTable(updatedStats);

            console.clear();
            console.log(updatedOutput);
            console.log(`\n${new Date().toLocaleTimeString()} - 按 Ctrl+C 退出`);
          }, interval);
        } else {
          // 单次输出
          console.log(output);
        }
      } catch (error) {
        console.error(
          `查看 Context 统计失败: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}

/**
 * 创建 context history 命令
 */
export function createContextHistoryCommand(): Command {
  return new Command('history')
    .description(t('commands.context.history.description'))
    .argument('[session-id]', t('commands.context.options.sessionId'))
    .option('-l, --limit <limit>', t('commands.context.history.options.limit'), '20')
    .option('-f, --format <format>', 'Output format (text/json)', 'text')
    .action(async (sessionId: string | undefined, options) => {
      try {
        // 获取统计收集器
        let collector: ContextStatsCollector | null;

        if (sessionId) {
          collector = await findSessionStats(sessionId);
        } else {
          collector = await findCurrentSessionStats();
        }

        if (!collector) {
          console.error(t('commands.context.notFound'));
          process.exit(1);
        }

        // 获取使用历史
        const history = collector.getUsageHistory(parseInt(options.limit, 10));

        if (options.format === 'json') {
          console.log(JSON.stringify(history, null, 2));
        } else {
          console.log(`\n📊 ${t('commands.context.history.title')}\n`);

          if (history.length === 0) {
            console.log(`  ${t('commands.context.history.empty')}`);
          } else {
            console.log(`  ${t('commands.context.history.header')}`);
            console.log('  ' + '─'.repeat(60));

            for (const entry of history) {
              const time = new Date(entry.timestamp).toLocaleTimeString();
              const tokens = entry.totalTokens.toLocaleString();
              const percentage = (entry.usageRatio * 100).toFixed(1);

              console.log(`  ${entry.turn.toString().padStart(4)}  |  ${time}  |  ${tokens.padStart(12)}  |  ${percentage}%`);
            }
          }

          console.log('');
        }
      } catch (error) {
        console.error(
          `${t('commands.context.history.description')}失败: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}

/**
 * 创建 context compaction 命令
 */
export function createContextCompactionCommand(): Command {
  return new Command('compaction')
    .description(t('commands.context.compaction.description'))
    .argument('[session-id]', t('commands.context.options.sessionId'))
    .option('-l, --limit <limit>', t('commands.context.compaction.options.limit'), '10')
    .option('-f, --format <format>', 'Output format (text/json)', 'text')
    .action(async (sessionId: string | undefined, options) => {
      try {
        // 获取统计收集器
        let collector: ContextStatsCollector | null;

        if (sessionId) {
          collector = await findSessionStats(sessionId);
        } else {
          collector = await findCurrentSessionStats();
        }

        if (!collector) {
          console.error(t('commands.context.notFound'));
          process.exit(1);
        }

        // 获取压缩历史
        const history = collector.getCompactionHistory(parseInt(options.limit, 10));

        if (options.format === 'json') {
          console.log(JSON.stringify(history, null, 2));
        } else {
          console.log(`\n📦 ${t('commands.context.compaction.title')}\n`);

          if (history.length === 0) {
            console.log(`  ${t('commands.context.compaction.empty')}`);
          } else {
            console.log(`  ${t('commands.context.compaction.header')}`);
            console.log('  ' + '─'.repeat(70));

            for (const entry of history) {
              const time = new Date(entry.timestamp).toLocaleTimeString();
              const reason = entry.reason === 'threshold' ? '阈值' :
                           entry.reason === 'summarization' ? '摘要' : '手动';
              const usageBefore = (entry.usageRatioBefore * 100).toFixed(1);
              const usageAfter = (entry.usageRatioAfter * 100).toFixed(1);

              console.log(`  ${time}  |  ${reason}  |  ${entry.removedCount.toString().padStart(10)}  |  ${entry.tokensSaved.toLocaleString().padStart(12)}  |  ${usageBefore}% → ${usageAfter}%`);
            }
          }

          console.log('');
        }
      } catch (error) {
        console.error(
          `${t('commands.context.compaction.description')}失败: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}

/**
 * 创建 context trend 命令
 */
export function createContextTrendCommand(): Command {
  return new Command('trend')
    .description(t('commands.context.trend.description'))
    .argument('[session-id]', t('commands.context.options.sessionId'))
    .option('-w, --width <width>', t('commands.context.trend.options.width'), '60')
    .action(async (sessionId: string | undefined, options) => {
      try {
        // 获取统计收集器
        let collector: ContextStatsCollector | null;

        if (sessionId) {
          collector = await findSessionStats(sessionId);
        } else {
          collector = await findCurrentSessionStats();
        }

        if (!collector) {
          console.error(t('commands.context.notFound'));
          process.exit(1);
        }

        // 创建可视化渲染器
        const visualizer = createContextVisualizer({
          enableColors: true,
        });

        // 获取使用历史
        const history = collector.getUsageHistory(parseInt(options.width, 10));

        // 渲染趋势图
        const trend = visualizer.renderUsageTrend(history, parseInt(options.width, 10));

        console.log(trend);
      } catch (error) {
        console.error(
          `${t('commands.context.trend.description')}失败: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
