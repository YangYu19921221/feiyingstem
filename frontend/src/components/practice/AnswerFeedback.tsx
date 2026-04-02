import React from 'react';
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
    <div className={`mt-4 p-4 rounded-2xl border-2 transition-all duration-300 ${
      isCorrect
        ? 'bg-green-50 border-green-200'
        : 'bg-red-50 border-red-200'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{isCorrect ? '✅' : '❌'}</span>
            {syllables ? (
              <ColoredWord word={word} syllables={syllables} className="text-lg font-bold" />
            ) : (
              <span className="font-bold text-lg">{word}</span>
            )}
            <button
              onClick={() => playAudio(word)}
              className="text-gray-400 hover:text-orange-500 transition-colors"
              title="播放发音"
            >
              🔊
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
              <p className="text-red-500">你的答案: {userAnswer}</p>
              <p className="text-green-600">正确答案: {correctAnswer}</p>
            </div>
          )}
        </div>

        <button
          onClick={onNext}
          className="shrink-0 px-5 py-2.5 bg-orange-500 text-white rounded-xl font-medium
                     hover:bg-orange-600 active:scale-95 transition-all shadow-sm"
        >
          {isLast ? '查看结果' : '下一题 →'}
        </button>
      </div>
    </div>
  );
};

export default AnswerFeedback;
