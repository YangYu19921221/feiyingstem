import React from 'react';
import ColoredPhonetic from '../ColoredPhonetic';
import { useAudio } from '../../hooks/useAudio';
import type { WordData } from '../../api/progress';

interface PracticeSidePanelProps {
  /** 当前题目对应的单词 */
  currentWord: string;
  currentPhonetic?: string;
  currentMeaning?: string;
  /** 单元完整单词列表 */
  unitWords: WordData[];
  /** 每道题的结果 */
  results: (boolean | null)[];
  /** 题目列表（用于匹配 unitWords 中的高亮） */
  questionWords: string[];
}

const PracticeSidePanel: React.FC<PracticeSidePanelProps> = ({
  currentWord,
  currentPhonetic,
  currentMeaning,
  unitWords,
  results,
  questionWords,
}) => {
  const { playAudio } = useAudio();

  return (
    <div className="space-y-5">
      {/* 当前单词详情 */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-3">当前单词</h3>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl font-bold text-gray-800">{currentWord}</span>
          <button
            onClick={() => playAudio(currentWord)}
            className="text-gray-400 hover:text-orange-500 transition-colors"
          >
            🔊
          </button>
        </div>
        {currentPhonetic && (
          <div className="mb-2">
            <ColoredPhonetic phonetic={currentPhonetic} size="sm" />
          </div>
        )}
        {currentMeaning && (
          <p className="text-sm text-gray-600">{currentMeaning}</p>
        )}
      </div>

      {/* 单元单词列表 */}
      {unitWords.length > 0 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-3">
            单元单词 ({unitWords.length})
          </h3>
          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {unitWords.map((w) => {
              const qIdx = questionWords.indexOf(w.word);
              const isCurrent = w.word.toLowerCase() === currentWord.toLowerCase();
              const result = qIdx >= 0 ? results[qIdx] : null;

              let statusIcon = '';
              let textColor = 'text-gray-500';
              if (result === true) { statusIcon = '✅'; textColor = 'text-green-600'; }
              else if (result === false) { statusIcon = '❌'; textColor = 'text-red-500'; }

              return (
                <div
                  key={w.id}
                  className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    isCurrent
                      ? 'bg-orange-50 border border-orange-200'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <span className={`font-medium ${isCurrent ? 'text-orange-600' : textColor}`}>
                    {w.word}
                  </span>
                  <span className="text-xs">
                    {statusIcon || (isCurrent ? '👈' : '')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default PracticeSidePanel;
