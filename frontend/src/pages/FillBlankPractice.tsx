import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import PracticeLayout from '../components/practice/PracticeLayout';
import AnswerFeedback from '../components/practice/AnswerFeedback';
import { usePracticeState } from '../hooks/usePracticeState';
import { usePracticeQuestions } from '../hooks/usePracticeQuestions';
import { useAudio } from '../hooks/useAudio';

const FillBlankPractice = () => {
  const { unitId } = useParams<{ unitId: string }>();
  const { playAudio } = useAudio();

  const { questions, unitInfo, unitWords, loading } = usePracticeQuestions({
    unitId,
    questionType: 'fillblank',
    questionCount: 10,
  });

  const {
    currentIndex, isChecking, isCorrect,
    timeSpent, results, accuracy, formatTime,
    recordAnswer, goToNext,
  } = usePracticeState({
    mode: 'fillblank',
    modeName: '填空练习',
    unitId,
    questions,
    unitName: unitInfo?.name,
    totalUnitWords: unitWords.length || undefined,
  });

  const [selectedAnswer, setSelectedAnswer] = useState('');

  const handleSelectAnswer = (answer: string) => {
    if (isChecking) return;
    setSelectedAnswer(answer);
    const correct = answer === questions[currentIndex].correct_answer;
    recordAnswer(correct);
  };

  const handleNext = () => {
    goToNext(() => setSelectedAnswer(''));
  };

  // 解析句子，将 ______ 替换为高亮空白
  const renderSentence = (question: string) => {
    const sentence = question.replace('选择正确的单词填空:\n', '');
    const parts = sentence.split('______');
    if (parts.length < 2) return <span>{sentence}</span>;
    return (
      <>
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < parts.length - 1 && (
              <span className="inline-block mx-1 min-w-[80px] relative">
                {isChecking && selectedAnswer ? (
                  <motion.span
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={`font-bold px-2 py-0.5 rounded ${isCorrect ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'}`}
                  >
                    {selectedAnswer}
                  </motion.span>
                ) : (
                  <span className="border-b-3 border-orange-400 px-4 py-0.5 inline-block">
                    <span className="animate-pulse text-orange-400">|</span>
                  </span>
                )}
              </span>
            )}
          </span>
        ))}
      </>
    );
  };

  const currentQuestion = questions[currentIndex];
  const questionWords = questions.map(q => q.word);

  return (
    <PracticeLayout
      loading={loading || questions.length === 0}
      loadingText="生成填空题中..."
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

          {/* 句子展示区 */}
          <div className="bg-gradient-to-r from-orange-50 to-yellow-50 rounded-xl p-5 mb-6 border border-orange-200">
            <p className="text-xl text-gray-800 leading-relaxed">
              {currentQuestion && renderSentence(currentQuestion.question)}
            </p>
          </div>

          {/* 选项卡片 2×2 网格 */}
          <div className="grid grid-cols-2 gap-3">
            {currentQuestion?.options?.map((option, idx) => {
              const isSelected = selectedAnswer === option;
              const isCorrectOption = option === currentQuestion.correct_answer;
              let cardStyle = 'bg-white border-gray-200 hover:border-orange-300 hover:shadow-md';
              if (isChecking) {
                if (isCorrectOption) {
                  cardStyle = 'bg-green-50 border-green-400 text-green-800';
                } else if (isSelected && !isCorrect) {
                  cardStyle = 'bg-red-50 border-red-400 text-red-800';
                } else {
                  cardStyle = 'bg-gray-50 border-gray-200 opacity-50';
                }
              }
              return (
                <motion.button
                  key={idx}
                  onClick={() => handleSelectAnswer(option)}
                  disabled={isChecking}
                  whileHover={!isChecking ? { scale: 1.03 } : {}}
                  whileTap={!isChecking ? { scale: 0.97 } : {}}
                  animate={isChecking && isSelected && isCorrectOption ? { scale: [1, 1.08, 1] } : {}}
                  transition={{ duration: 0.3 }}
                  className={`p-4 rounded-xl border-2 font-bold text-center text-lg shadow-sm transition-colors ${cardStyle}`}
                >
                  {option}
                  {isChecking && isCorrectOption && <span className="ml-1">✓</span>}
                  {isChecking && isSelected && !isCorrect && !isCorrectOption && <span className="ml-1">✗</span>}
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

export default FillBlankPractice;
