import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb } from 'lucide-react';
import PracticeLayout from '../components/practice/PracticeLayout';
import AnswerFeedback from '../components/practice/AnswerFeedback';
import { usePracticeState } from '../hooks/usePracticeState';
import { usePracticeQuestions } from '../hooks/usePracticeQuestions';
import { useAudio } from '../hooks/useAudio';

const SpellingPractice = () => {
  const { unitId } = useParams<{ unitId: string }>();
  const { playAudio } = useAudio();
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const { questions, unitInfo, unitWords, loading } = usePracticeQuestions({
    unitId,
    questionType: 'spelling',
    questionCount: 10,
  });

  const {
    currentIndex, isChecking, isCorrect,
    timeSpent, results, accuracy, formatTime,
    recordAnswer, goToNext,
  } = usePracticeState({
    mode: 'spelling',
    modeName: '拼写练习',
    unitId,
    questions,
    unitName: unitInfo?.name,
    totalUnitWords: unitWords.length || undefined,
  });

  const [userInput, setUserInput] = useState('');
  const [hintsUsed, setHintsUsed] = useState(0);
  const [revealedLetters, setRevealedLetters] = useState<Set<number>>(new Set());
  const [letterResults, setLetterResults] = useState<string[]>([]);
  const [attemptCount, setAttemptCount] = useState(0);
  const [showCorrectAnswer, setShowCorrectAnswer] = useState(false);

  const handleHint = () => {
    const answer = questions[currentIndex].correct_answer;
    for (let i = 0; i < answer.length; i++) {
      // 跳过空格位置
      if (answer[i] === ' ') continue;
      if (!revealedLetters.has(i)) {
        setRevealedLetters(prev => new Set(prev).add(i));
        setHintsUsed(h => h + 1);
        break;
      }
    }
  };

  const handleCheck = () => {
    const currentQuestion = questions[currentIndex];
    const answer = currentQuestion.correct_answer.trim();
    const input = userInput.trim();
    const correct = input === answer;

    // 逐字母对比
    const compareResults: string[] = [];
    for (let i = 0; i < answer.length; i++) {
      if (i < input.length) {
        compareResults.push(input[i] === answer[i] ? 'correct' : 'wrong');
      } else {
        compareResults.push('missing');
      }
    }
    setLetterResults(compareResults);

    if (correct) {
      setShowCorrectAnswer(false);
      recordAnswer(true);
    } else {
      const newCount = attemptCount + 1;
      setAttemptCount(newCount);
      if (newCount >= 3) {
        setShowCorrectAnswer(true);
        recordAnswer(false);
      }
      // 前3次不调用 recordAnswer，让用户重试
    }
  };

  const handleNext = () => {
    goToNext(() => {
      setUserInput('');
      setLetterResults([]);
      setRevealedLetters(new Set());
      setAttemptCount(0);
      setShowCorrectAnswer(false);
    });
  };

  const focusInput = () => hiddenInputRef.current?.focus();
  const currentQuestion = questions[currentIndex];
  const answerLength = currentQuestion?.correct_answer.length || 0;
  const questionWords = questions.map(q => q.word);

  return (
    <PracticeLayout
      loading={loading || questions.length === 0}
      loadingText="生成拼写题中..."
      unitName={unitInfo?.name}
      totalWords={unitWords.length || undefined}
      accuracy={accuracy}
      timeSpent={timeSpent}
      formatTime={formatTime}
      total={questions.length}
      results={results}
      currentIndex={currentIndex}
      currentWord={currentQuestion?.word || ''}
      currentPhonetic={currentQuestion?.phonetic}
      currentMeaning={currentQuestion?.meaning}
      unitWords={unitWords}
      questionWords={questionWords}
      hideAnswer
    >
      {/* 题目卡片 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -50 }}
          className="bg-white rounded-2xl shadow-lg p-6 mb-6"
        >
          <div className="text-sm text-gray-400 mb-2">
            第 {currentIndex + 1} / {questions.length} 题
          </div>

          {/* 题目文字 + 发音 */}
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              {currentQuestion?.question}
            </h2>
            <button
              onClick={() => currentQuestion && playAudio(currentQuestion.word)}
              className="inline-flex items-center gap-2 px-5 py-2 bg-orange-100 text-orange-700 rounded-full hover:bg-orange-200 transition"
            >
              🔊 播放发音
            </button>
            <p className="text-sm text-gray-400 mt-2">
              共 {answerLength} 个字符{currentQuestion?.correct_answer.includes(' ') ? '（含空格）' : ''}
            </p>
          </div>

          {/* 隐藏输入框 */}
          <input
            ref={hiddenInputRef}
            type="text"
            value={userInput}
            onChange={(e) => {
              if (!isChecking) {
                const val = e.target.value.replace(/[^a-zA-Z '\-!?.,]/g, '');
                setUserInput(val.slice(0, answerLength));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isChecking && userInput.trim()) handleCheck();
            }}
            className="opacity-0 absolute -z-10"
            autoFocus
            disabled={isChecking}
          />

          {/* Wordle 风格字母格子 */}
          <div className="flex justify-center gap-2 mb-6 overflow-x-auto pb-1" style={{ flexWrap: 'nowrap' }} onClick={focusInput}>
            {currentQuestion && Array.from({ length: answerLength }).map((_, i) => {
              const answer = currentQuestion.correct_answer;
              const isSpace = answer[i] === ' ';

              // 空格位置固定显示为间隔标记
              if (isSpace) {
                return (
                  <motion.div
                    key={i}
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    className="w-6 h-14 flex items-center justify-center text-gray-300 text-sm"
                  >
                    ␣
                  </motion.div>
                );
              }

              let bgColor = 'bg-gray-100 border-gray-300';
              let textColor = 'text-gray-800';
              let letter = '';

              if (isChecking && letterResults[i]) {
                if (letterResults[i] === 'correct') {
                  bgColor = 'bg-green-100 border-green-400';
                  textColor = 'text-green-700';
                } else if (letterResults[i] === 'wrong') {
                  bgColor = 'bg-red-100 border-red-400';
                  textColor = 'text-red-700';
                } else {
                  bgColor = 'bg-gray-200 border-gray-400';
                  textColor = 'text-gray-400';
                }
                letter = i < userInput.length ? userInput[i] : '';
              } else if (revealedLetters.has(i)) {
                letter = answer[i];
                bgColor = 'bg-yellow-50 border-yellow-400';
                textColor = 'text-yellow-700';
              } else if (i < userInput.length) {
                letter = userInput[i];
                bgColor = 'bg-orange-50 border-orange-400';
              } else if (i === 0 && !userInput) {
                letter = answer[0];
                bgColor = 'bg-blue-50 border-blue-300';
                textColor = 'text-blue-400';
              }

              const isCurrent = i === userInput.length && !isChecking;

              return (
                <motion.div
                  key={i}
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className={`w-12 h-14 flex items-center justify-center border-2 rounded-xl text-2xl font-bold ${bgColor} ${textColor} ${
                    isCurrent ? 'ring-2 ring-orange-400 animate-pulse' : ''
                  }`}
                >
                  {letter}
                </motion.div>
              );
            })}
          </div>

          {/* 提示按钮 */}
          {!isChecking && (
            <div className="text-center mb-6">
              <button
                onClick={handleHint}
                disabled={revealedLetters.size >= answerLength - 1}
                className="inline-flex items-center gap-1 px-4 py-2 text-sm bg-yellow-100 text-yellow-700 rounded-full hover:bg-yellow-200 transition disabled:opacity-40"
              >
                <Lightbulb size={16} />
                提示一个字母 ({revealedLetters.size}/{answerLength - 1})
              </button>
            </div>
          )}

          {/* 错误重试提示 */}
          {attemptCount > 0 && !isChecking && (
            <div className="text-center mb-4">
              <p className="text-red-500 text-sm font-medium">
                拼写不正确，请重试 ({attemptCount}/3)
              </p>
            </div>
          )}

          {/* 检查按钮 */}
          {!isChecking && (
            <button
              onClick={handleCheck}
              disabled={!userInput.trim()}
              className="w-full py-3 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl font-bold text-lg hover:shadow-lg transition disabled:opacity-50"
            >
              {attemptCount > 0 ? `再试一次 (${3 - attemptCount}次机会)` : '检查拼写 ✏️'}
            </button>
          )}
        </motion.div>
      </AnimatePresence>

      {/* 答题后反馈 */}
      <AnimatePresence>
        {isChecking && currentQuestion && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <AnswerFeedback
              isCorrect={isCorrect!}
              word={currentQuestion.word}
              phonetic={currentQuestion.phonetic}
              meaning={currentQuestion.meaning}
              correctAnswer={currentQuestion.correct_answer}
              userAnswer={!isCorrect ? userInput : undefined}
              onNext={handleNext}
              isLast={currentIndex >= questions.length - 1}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </PracticeLayout>
  );
};

export default SpellingPractice;
