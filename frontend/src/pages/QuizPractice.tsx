import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import ColoredPhonetic from '../components/ColoredPhonetic';
import PracticeLayout from '../components/practice/PracticeLayout';
import AnswerFeedback from '../components/practice/AnswerFeedback';
import { usePracticeState } from '../hooks/usePracticeState';
import { usePracticeQuestions } from '../hooks/usePracticeQuestions';
import { useAudio } from '../hooks/useAudio';

const QuizPractice = () => {
  const { unitId } = useParams<{ unitId: string }>();
  const { playAudio } = useAudio();

  const { questions, unitInfo, unitWords, loading } = usePracticeQuestions({
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
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="text-center mb-4"
          >
            <span className="text-2xl font-bold text-orange-500">
              🔥 ×{combo} 连击!
            </span>
          </motion.div>
        )}
      </AnimatePresence>

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
          <h2 className="text-xl font-bold text-gray-800 mb-6">
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
                  onClick={() => handleSelectAnswer(option)}
                  disabled={isChecking}
                  animate={isChecking && isSelected && !isCorrect ? { x: [0, -8, 8, -8, 8, 0] } : {}}
                  transition={{ duration: 0.4 }}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${optionStyle}`}
                >
                  <span className="font-medium">
                    {String.fromCharCode(65 + idx)}. {option}
                  </span>
                  {isChecking && isCorrectOption && (
                    <span className="float-right text-green-500">✓</span>
                  )}
                  {isChecking && isSelected && !isCorrect && !isCorrectOption && (
                    <span className="float-right text-red-500">✗</span>
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
