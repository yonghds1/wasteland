/**
 * useLogsManager.ts - TUI 层的状态抽取 (Phase 3 Refactoring)
 */
import { useState, useEffect } from 'react';
import type { RuntimeEvent } from '../../core/runtime/event-types.js';

export interface LogsManagerState {
  filteredLogs: RuntimeEvent[];
  filterLevel: 'info' | 'debug' | 'error';
  setFilterLevel: (level: 'info' | 'debug' | 'error') => void;
  clearLogs: () => void;
}

export function useLogsManager(rawLogs: RuntimeEvent[]): LogsManagerState {
  const [filterLevel, setFilterLevel] = useState<'info' | 'debug' | 'error'>('debug');
  const [filteredLogs, setFilteredLogs] = useState<RuntimeEvent[]>([]);

  useEffect(() => {
    setFilteredLogs(rawLogs);
  }, [rawLogs, filterLevel]);

  const clearLogs = () => {
    setFilteredLogs([]);
  };

  return {
    filteredLogs,
    filterLevel,
    setFilterLevel,
    clearLogs,
  };
}
