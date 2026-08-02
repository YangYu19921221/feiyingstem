import React from 'react';
import { ArrowLeft, BookOpenText } from 'lucide-react';
import useGoBack from '../../hooks/useGoBack';

interface PracticeHeaderProps {
  unitName?: string;
  totalWords?: number;
  accuracy: number;
  timeSpent: number;
  formatTime: (s: number) => string;
}

const PracticeHeader: React.FC<PracticeHeaderProps> = ({
  unitName,
  totalWords,
  accuracy,
  timeSpent,
  formatTime,
}) => {
  const goBack = useGoBack('/student/dashboard');

  return (
    <header className="mb-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:gap-3">
      <button
        type="button"
        onClick={() => goBack()}
        className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-medium text-ink-soft transition hover:bg-orange-50 hover:text-accent-warm sm:px-3"
        aria-label="退出练习并返回上一页"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs sm:text-sm">退出</span>
      </button>

      {unitName && (
        <div className="mx-auto flex min-w-0 max-w-full items-center gap-1.5 rounded-xl bg-white px-2 py-2 text-sm text-ink-soft ring-1 ring-black/[0.05] sm:px-3">
          <BookOpenText className="h-4 w-4 shrink-0 text-accent-warm" aria-hidden="true" />
          <span className="truncate">{unitName}</span>
          {totalWords ? <span className="hidden shrink-0 text-ink-mute sm:inline">· {totalWords} 个词</span> : null}
        </div>
      )}

      <div className="flex items-center gap-2 text-sm font-numeric">
        <span className="hidden text-ink-mute sm:inline">{formatTime(timeSpent)}</span>
        <span className="rounded-lg bg-orange-50 px-2 py-1.5 font-semibold text-accent-warm" aria-label={`当前正确率 ${accuracy}%`}>
          {accuracy}%
        </span>
      </div>
    </header>
  );
};

export default PracticeHeader;
