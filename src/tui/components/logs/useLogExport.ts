import { useState, useCallback } from 'react';
import type { LogEntry } from '@core/logger/index.js';
import type { ProjectSessionSummary } from '@core/logger/data-store.js';
import { exportLogEntries, type LogExportFormat } from '../log-export.js';

export interface UseLogExportOptions {
  selectedSessionSummary?: ProjectSessionSummary;
  sessionCards: LogEntry[];
  effectiveExportDir: string;
}

export function useLogExport({
  selectedSessionSummary,
  sessionCards,
  effectiveExportDir,
}: UseLogExportOptions) {
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const handleExport = useCallback(
    async (format: LogExportFormat): Promise<void> => {
      if (!selectedSessionSummary) {
        setExportStatus('✗ 导出失败: 未选中 session');
        return;
      }
      if (sessionCards.length === 0) {
        setExportStatus('✗ 导出失败: 当前过滤下没有日志');
        return;
      }
      try {
        const filePath = await exportLogEntries({
          dir: effectiveExportDir,
          sessionId: selectedSessionSummary.sessionId,
          entries: sessionCards,
          format,
        });
        setExportStatus(`✓ 已导出 ${sessionCards.length} 条${format === 'markdown' ? ' markdown' : ' JSON'} → ${filePath}`);
      } catch (err) {
        setExportStatus(`✗ 导出失败: ${(err as Error).message}`);
      }
    },
    [selectedSessionSummary, sessionCards, effectiveExportDir],
  );

  return {
    exportStatus,
    setExportStatus,
    handleExport,
  };
}
