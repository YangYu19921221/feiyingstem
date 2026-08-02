import React from 'react';
import { ArrowRight, CheckCircle2, Volume2, XCircle } from 'lucide-react';
import ColoredPhonetic from '../ColoredPhonetic';
import ColoredWord from '../ColoredWord';
import { useAudio } from '../../hooks/useAudio';

interface AnswerFeedbackProps {
  isCorrect: boolean;
  word: string;
  phonetic?: string;
  meaning?: string;
  correctAnswer: string;
  userAnswer?: string;
  onNext: () => void;
  isLast: boolean;
  syllables?: string;
}

const AnswerFeedback: React.FC<AnswerFeedbackProps> = ({
  isCorrect,
  word,
  phonetic,
  meaning,
  correctAnswer,
  userAnswer,
  onNext,
  isLast,
  syllables,
}) => {
  const { playAudio } = useAudio();

  return (
    <section role="status" aria-live="polite" className={`mt-4 rounded-2xl border p-4 transition-all duration-200 sm:p-5 ${
      isCorrect
        ? 'border-green-200 bg-green-50'
        : 'border-red-200 bg-red-50'
    }`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            {isCorrect
              ? <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" aria-hidden="true" />
              : <XCircle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />}
            {syllables ? (
              <ColoredWord word={word} syllables={syllables} className="text-lg font-bold" />
            ) : (
              <span className="font-bold text-lg">{word}</span>
            )}
            <button
              type="button"
              onClick={() => playAudio(word)}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/70 hover:text-accent-warm"
              aria-label={`播放 ${word} 的发音`}
            >
              <Volume2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {phonetic && (
            <div className="mb-2">
              <ColoredPhonetic phonetic={phonetic} size="sm" />
            </div>
          )}

          {meaning && (
            <p className="text-sm text-gray-600 mb-2">{meaning}</p>
          )}

          {!isCorrect && userAnswer && (
            <div className="text-sm space-y-1">
              <p className="text-red-600">你的答案：{userAnswer}</p>
              <p className="text-green-700">正确答案：{correctAnswer}</p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onNext}
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-accent-warm px-5 font-semibold text-white transition hover:opacity-90 active:scale-[0.98] sm:w-auto"
        >
          {isLast ? '查看结果' : '下一题'}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
};

export default AnswerFeedback;
