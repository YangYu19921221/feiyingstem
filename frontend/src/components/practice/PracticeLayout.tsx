import React from 'react';
import { LoaderCircle } from 'lucide-react';
import PracticeHeader from './PracticeHeader';
import ProgressDots from './ProgressDots';
import PracticeSidePanel from './PracticeSidePanel';
import type { WordData } from '../../api/progress';

interface PracticeLayoutProps {
  children: React.ReactNode;
  /** Header props */
  unitName?: string;
  totalWords?: number;
  accuracy: number;
  timeSpent: number;
  formatTime: (s: number) => string;
  /** ProgressDots props */
  total: number;
  results: (boolean | null)[];
  currentIndex: number;
  /** SidePanel props */
  currentWord: string;
  currentPhonetic?: string;
  currentMeaning?: string;
  unitWords: WordData[];
  questionWords: string[];
  /** 加载状态 */
  loading?: boolean;
  loadingText?: string;
  /** 隐藏答案（选择题/填空题模式） */
  hideAnswer?: boolean;
}

const PracticeLayout: React.FC<PracticeLayoutProps> = ({
  children,
  unitName,
  totalWords,
  accuracy,
  timeSpent,
  formatTime,
  total,
  results,
  currentIndex,
  currentWord,
  currentPhonetic,
  currentMeaning,
  unitWords,
  questionWords,
  loading,
  loadingText = '正在准备题目...',
  hideAnswer = false,
}) => {
  if (loading) {
    return (
      <main className="page-warm-glow flex min-h-screen items-center justify-center bg-paper px-4" aria-busy="true">
        <div className="text-center" role="status">
          <LoaderCircle className="mx-auto mb-4 h-9 w-9 animate-spin text-accent-warm" aria-hidden="true" />
          <p className="text-sm font-medium text-ink-soft">{loadingText}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page-warm-glow min-h-screen bg-paper">
      <div className="mx-auto max-w-2xl px-4 py-4 sm:py-6 lg:max-w-6xl">
        <PracticeHeader
          unitName={unitName}
          totalWords={totalWords}
          accuracy={accuracy}
          timeSpent={timeSpent}
          formatTime={formatTime}
        />

        <ProgressDots
          total={total}
          results={results}
          currentIndex={currentIndex}
        />

        <div className="flex flex-col lg:flex-row lg:gap-8">
          {/* 主内容区 */}
          <div className="lg:w-2/3">
            {children}
          </div>

          {/* 桌面端侧边栏 */}
          <div className="hidden lg:block lg:w-1/3 mt-6 lg:mt-0">
            <PracticeSidePanel
              currentWord={currentWord}
              currentPhonetic={currentPhonetic}
              currentMeaning={currentMeaning}
              unitWords={unitWords}
              results={results}
              questionWords={questionWords}
              currentIndex={currentIndex}
              hideAnswer={hideAnswer}
            />
          </div>
        </div>
      </div>
    </main>
  );
};

export default PracticeLayout;
