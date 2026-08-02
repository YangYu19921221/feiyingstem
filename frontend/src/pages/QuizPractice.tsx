import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, Flame, X } from 'lucide-react';
import PracticeLayout from '../components/practice/PracticeLayout';
import PracticeLoadError from '../components/practice/PracticeLoadError';
import AnswerFeedback from '../components/practice/AnswerFeedback';
import { usePracticeState } from '../hooks/usePracticeState';
import { usePracticeQuestions } from '../hooks/usePracticeQuestions';

const QuizPractice = () => {
  const { unitId } = useParams<{ unitId: string }>();
  const reduceMotion = useReducedMotion();

  const { questions, unitInfo, unitWords, loading, error, retry } = usePracticeQuestions({
    unitId,
    questionType: 'choice',
    questionCount: 10,
  });

  const {
    currentIndex, isChecking, isCorrect, score,
    timeSpent, results, accuracy, formatTime,
    recordAnswer, goToNext,
  } = usePracticeState({
    mode: 'quiz',
    modeName: 'AI测试',
    unitId,
    questions,
    unitName: unitInfo?.name,
    totalUnitWords: unitWords.length || undefined,
  });

  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [showCombo, setShowCombo] = useState(false);

  const handleSelectAnswer = (answer: string) => {
    if (isChecking) return;
    setSelectedAnswer(answer);
    const correct = answer === questions[currentIndex].correct_answer;
    recordAnswer(correct);
    if (correct) {
      const newCombo = combo + 1;
      setCombo(newCombo);
      if (newCombo > maxCombo) setMaxCombo(newCombo);
      if (newCombo >= 2) {
        setShowCombo(true);
        setTimeout(() => setShowCombo(false), 1200);
      }
    } else {
      setCombo(0);
    }
  };

  const handleNext = () => {
    goToNext(() => setSelectedAnswer(''));
  };

  const currentQuestion = questions[currentIndex];
  const questionWords = questions.map(q => q.word);

  if (error) {
    return (
      <PracticeLoadError
        title="测试题暂时没准备好"
        message={error}
        onRetry={retry}
      />
    );
  }

  return (
    <PracticeLayout
      loading={loading || questions.length === 0}
      loadingText="生成测试题中..."
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
      {/* Combo 动画 */}
      <AnimatePresence>
        {showCombo && combo >= 2 && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
            className="text-center mb-4"
          >
            <span className="inline-flex items-center gap-2 rounded-xl bg-orange-50 px-4 py-2 text-lg font-bold text-accent-warm">
              <Flame className="h-5 w-5" aria-hidden="true" />
              ×{combo} 连击
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 题目卡片 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={reduceMotion ? false : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, x: -24 }}
          transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="card-soft mb-6 rounded-2xl p-4 sm:p-6"
        >
          <div className="mb-2 font-numeric text-sm text-ink-mute">
            第 {currentIndex + 1} / {questions.length} 题
          </div>
          <h2 className="mb-6 text-balance text-xl font-bold leading-8 text-ink">
            {currentQuestion?.question}
          </h2>

          {/* 选项 */}
          <div className="space-y-3">
            {currentQuestion?.options?.map((option, idx) => {
              const isSelected = selectedAnswer === option;
              const isCorrectOption = option === currentQuestion.correct_answer;
              let optionStyle = 'bg-gray-50 border-gray-200 hover:border-orange-300 hover:bg-orange-50';
              if (isChecking) {
                if (isCorrectOption) {
                  optionStyle = 'bg-green-50 border-green-400 text-green-800';
                } else if (isSelected && !isCorrect) {
                  optionStyle = 'bg-red-50 border-red-400 text-red-800';
                } else {
                  optionStyle = 'bg-gray-50 border-gray-200 opacity-50';
                }
              } else if (isSelected) {
                optionStyle = 'bg-orange-50 border-orange-400';
              }

              return (
                <motion.button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectAnswer(option)}
                  disabled={isChecking}
                  animate={!reduceMotion && isChecking && isSelected && !isCorrect ? { x: [0, -6, 6, -4, 4, 0] } : {}}
                  transition={{ duration: 0.4 }}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition-colors ${optionStyle}`}
                >
                  <span className="min-w-0 flex-1 font-medium">
                    {String.fromCharCode(65 + idx)}. {option}
                  </span>
                  {isChecking && isCorrectOption && (
                    <Check className="h-5 w-5 shrink-0 text-green-600" aria-label="正确答案" />
                  )}
                  {isChecking && isSelected && !isCorrect && !isCorrectOption && (
                    <X className="h-5 w-5 shrink-0 text-red-600" aria-label="你的选择" />
                  )}
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* 答题后反馈 */}
      <AnimatePresence>
        {isChecking && currentQuestion && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -14 }}
            transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <AnswerFeedback
              isCorrect={isCorrect!}
              word={currentQuestion.word}
              phonetic={currentQuestion.phonetic}
              meaning={currentQuestion.meaning}
              correctAnswer={currentQuestion.correct_answer}
              userAnswer={!isCorrect ? selectedAnswer : undefined}
              onNext={handleNext}
              isLast={currentIndex >= questions.length - 1}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </PracticeLayout>
  );
};

export default QuizPractice;
