import React from 'react';
import { ArrowRight, Check, CircleX, ListChecks, Volume2 } from 'lucide-react';
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
  currentIndex: number;
  /** 是否隐藏答案信息（选择题/填空题模式下隐藏当前单词和列表中的高亮） */
  hideAnswer?: boolean;
}

const PracticeSidePanel: React.FC<PracticeSidePanelProps> = ({
  currentWord,
  currentPhonetic,
  currentMeaning,
  unitWords,
  results,
  questionWords,
  currentIndex,
  hideAnswer = false,
}) => {
  const { playAudio } = useAudio();
  const answeredCount = results.filter((result) => result !== null).length;
  const correctCount = results.filter((result) => result === true).length;

  return (
    <div className="space-y-5">
      {/* 当前单词详情 - hideAnswer 模式下隐藏 */}
      {!hideAnswer && (
        <section className="card-soft rounded-2xl p-5" aria-labelledby="current-word-title">
          <h3 id="current-word-title" className="mb-3 text-sm font-semibold text-ink-soft">当前单词</h3>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-display text-2xl font-semibold text-ink">{currentWord}</span>
            <button
              type="button"
              onClick={() => playAudio(currentWord)}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-mute transition hover:bg-orange-50 hover:text-accent-warm"
              aria-label={`播放 ${currentWord} 的发音`}
            >
              <Volume2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {currentPhonetic && (
            <div className="mb-2">
              <ColoredPhonetic phonetic={currentPhonetic} size="sm" />
            </div>
          )}
          {currentMeaning && (
            <p className="text-sm text-ink-soft">{currentMeaning}</p>
          )}
        </section>
      )}

      {/* 单元单词列表 */}
      {(hideAnswer ? questionWords.length > 0 : unitWords.length > 0) && (
        <section className="card-soft rounded-2xl p-5" aria-labelledby="practice-side-title">
          <div className="mb-4 flex items-start justify-between gap-3 border-b border-black/[0.06] pb-4">
            <div>
              <h3 id="practice-side-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
                <ListChecks className="h-4 w-4 text-accent-warm" aria-hidden="true" />
                {hideAnswer ? '答题进度' : '本单元单词'}
              </h3>
              <p className="mt-1 text-xs text-ink-mute">
                {hideAnswer ? `已完成 ${answeredCount}/${questionWords.length}` : `共 ${unitWords.length} 个词`}
              </p>
            </div>
            {hideAnswer && (
              <span className="font-numeric text-sm font-semibold text-accent-warm">{correctCount} 对</span>
            )}
          </div>

          {hideAnswer ? (
            <ol className="max-h-80 overflow-y-auto pr-1 custom-scrollbar">
              {questionWords.map((_, index) => {
                const result = results[index];
                const isCurrent = index === currentIndex;
                return (
                  <li
                    key={index}
                    className={`flex min-h-10 items-center gap-3 border-b border-black/[0.05] px-1 py-2 text-sm last:border-b-0 ${isCurrent ? 'text-accent-warm' : 'text-ink-soft'}`}
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    <span className="font-numeric w-8 text-xs text-ink-mute">{String(index + 1).padStart(2, '0')}</span>
                    <span className="flex-1 font-medium">
                      {result === true ? '回答正确' : result === false ? '继续巩固' : isCurrent ? '正在作答' : '等待作答'}
                    </span>
                    {result === true ? (
                      <Check className="h-4 w-4 text-green-600" aria-hidden="true" />
                    ) : result === false ? (
                      <CircleX className="h-4 w-4 text-red-500" aria-hidden="true" />
                    ) : isCurrent ? (
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
          <div className="max-h-80 overflow-y-auto pr-1 custom-scrollbar">
            {unitWords.map((w) => {
              const qIdx = questionWords.indexOf(w.word);
              const isCurrent = w.word.toLowerCase() === currentWord.toLowerCase();
              const result = qIdx >= 0 ? results[qIdx] : null;

              let textColor = 'text-gray-500';
              if (result === true) textColor = 'text-green-600';
              else if (result === false) textColor = 'text-red-500';

              return (
                <div
                  key={w.id}
                  className={`flex min-h-10 items-center justify-between border-b border-black/[0.05] px-1 py-2 text-sm last:border-b-0 ${
                    !hideAnswer && isCurrent
                      ? 'text-accent-warm'
                      : ''
                  }`}
                >
                  <span className={`font-medium ${!hideAnswer && isCurrent ? 'text-orange-600' : textColor}`}>
                    {w.word}
                  </span>
                  {result === true ? <Check className="h-4 w-4 text-green-600" aria-hidden="true" /> : null}
                  {result === false ? <CircleX className="h-4 w-4 text-red-500" aria-hidden="true" /> : null}
                  {!hideAnswer && isCurrent && result === null ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
                </div>
              );
            })}
          </div>
          )}
        </section>
      )}
    </div>
  );
};

export default PracticeSidePanel;
