import React from 'react';
import { useAppContext } from './context/AppContext.js';
import { LogsPage } from './components/LogsPage.js';
import { ChatArea } from './components/ChatArea.js';
import { SessionIndexPage } from './components/SessionIndexPage.js';
import type { TuiRuntimeContext } from './types.js';

export interface AppRouterProps {
  runtime: TuiRuntimeContext;
  sendMessage: (content: string) => Promise<void>;
}

export function AppRouter({ runtime, sendMessage }: AppRouterProps): React.ReactElement {
  const { state, setCurrentPage } = useAppContext();

  switch (state.currentPage) {
    case 'logs':
      return <LogsPage />;
    case 'sessions':
      return <SessionIndexPage onClose={() => setCurrentPage('session')} />;
    case 'session':
    default:
      return <ChatArea runtime={runtime} sendMessage={sendMessage} />;
  }
}
