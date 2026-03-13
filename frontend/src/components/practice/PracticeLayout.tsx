import React from 'react';
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
}) => {
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-orange-50 to-amber-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-bounce">📝</div>
          <p className="text-gray-500">{loadingText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-amber-50">
      <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 py-6">
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
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PracticeLayout;
