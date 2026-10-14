import React from 'react';
import { ArrowLeft, PanelRight, PanelRightClose } from 'lucide-react';

interface EditorHeaderProps {
  title: React.ReactNode;
  icon: React.ReactNode;
  onBack: () => void;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
  centerContent?: React.ReactNode;
  rightContent?: React.ReactNode;
}

export function EditorHeader({
  title,
  icon,
  onBack,
  onToggleSidebar,
  isSidebarOpen,
  centerContent,
  rightContent,
}: EditorHeaderProps) {
  return (
    <header className="h-14 min-h-14 border-b border-workspace-200 flex items-center gap-2 px-3 sm:px-4 bg-white/80 backdrop-blur-md z-30 relative shadow-sm select-none font-sans">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className={`shrink-0 p-2 rounded-lg transition-colors ${isSidebarOpen ? 'bg-primary-50 text-primary-700' : 'text-workspace-500 hover:bg-workspace-100 hover:text-workspace-800'}`}
          title={isSidebarOpen ? 'Hide details sidebar' : 'Show details sidebar'}
          aria-label={isSidebarOpen ? 'Hide details sidebar' : 'Show details sidebar'}
          aria-pressed={isSidebarOpen}
        >
          {isSidebarOpen ? <PanelRightClose size={17} /> : <PanelRight size={17} />}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-workspace-200 text-workspace-600 hover:bg-workspace-100 hover:text-workspace-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          title="Return to Dashboard"
          aria-label="Return to Dashboard"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="h-6 w-px bg-workspace-200 shrink-0" aria-hidden="true" />
        <div className="shrink-0 text-primary-600">{icon}</div>
        <div className="min-w-0 truncate text-sm font-semibold text-workspace-900">{title}</div>
      </div>
      {centerContent && <div className="hidden lg:flex shrink-0 items-center">{centerContent}</div>}
      {rightContent && <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">{rightContent}</div>}
    </header>
  );
}
