import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Lightbulb } from 'lucide-react';
import api from '../api/client';
import { submitMistakePracticeRecord } from '../api/learningRecords';
import AnswerFeedback from '../components/practice/AnswerFeedback';
import ColoredPhonetic from '../components/ColoredPhonetic';
import { useAudio } from '../hooks/useAudio';
import { toast } from '../components/Toast';

type QuestionType = 'quiz' | 'fillblank' | 'spelling';

interface MixedQuestion {
  type: QuestionType;
  word_id: number;
  word: string;
  phonetic?: string;
  meaning?: string;
  question?: string;
  options?: string[];
  correct_answer: string;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  quiz: '选择题',
  fillblank: '填空',
  spelling: '拼写',
};

const TYPE_COLORS: Record<QuestionType, string> = {
  quiz: 'bg-blue-100 text-blue-700',
  fillblank: 'bg-purple-100 text-purple-700',
  spelling: 'bg-orange-100 text-orange-700',
};

async function loadQuestions(): Promise<MixedQuestion[]> {
  const wordsJson = sessionStorage.getItem('mistake_practice_words');
  if (!wordsJson) throw new Error('错题数据丢失');
  const words: any[] = JSON.parse(wordsJson);

  const quizWords = words.filter((_, i) => i % 3 === 0);
  const fillWords = words.filter((_, i) => i % 3 === 1);

  const call = (wds: any[], type: string) =>
    wds.length === 0
      ? Promise.resolve([])
      : api
          .post('/ai/generate-quiz-from-words', {
            word_ids: wds.map(w => w.word_id),
            question_count: wds.length,
            question_type: type,
          }, { timeout: 60000 })
          .then((r: any) => r.questions as any[]);

  const [quizQs, fillQs] = await Promise.all([
    call(quizWords, 'choice'),
    call(fillWords, 'fillblank'),
  ]);

  const quizMap = new Map(quizQs.map((q: any) => [q.word_id, q]));
  const fillMap = new Map(fillQs.map((q: any) => [q.word_id, q]));

  return words.map((w, i): MixedQuestion => {
    const type: QuestionType = i % 3 === 0 ? 'quiz' : i % 3 === 1 ? 'fillblank' : 'spelling';
    if (type === 'quiz') {
      const q = quizMap.get(w.word_id) as any;
      return {
        type, word_id: w.word_id,
        word: q?.word || w.word,
        phonetic: q?.phonetic || w.phonetic,
        meaning: q?.meaning || w.meaning,
        question: q?.question,
        options: q?.options,
        correct_answer: q?.correct_answer || w.word,
      };
    }
    if (type === 'fillblank') {
      const q = fillMap.get(w.word_id) as any;
      return {
        type, word_id: w.word_id,
        word: q?.word || w.word,
        phonetic: q?.phonetic || w.phonetic,
        meaning: q?.meaning || w.meaning,
        question: q?.question,
        options: q?.options,
        correct_answer: q?.correct_answer || w.word,
      };
    }
    return {
      type, word_id: w.word_id, word: w.word,
      phonetic: w.phonetic, meaning: w.meaning,
      correct_answer: w.word,
    };
  });
}

const MistakePractice = () => {
  const navigate = useNavigate();
  const { playAudio } = useAudio();
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const [questions, setQuestions] = useState<MixedQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);

  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  const [userInput, setUserInput] = useState('');
  const [letterResults, setLetterResults] = useState<string[]>([]);
  const [revealedLetters, setRevealedLetters] = useState<Set<number>>(new Set());
  const [attemptCount, setAttemptCount] = useState(0);
  const [showCorrectAnswer, setShowCorrectAnswer] = useState(false);

  useEffect(() => {
    loadQuestions()
      .then(qs => { setQuestions(qs); setLoading(false); })
      .catch(() => { toast.error('加载题目失败，请重试'); navigate(-1); });
  }, [navigate]);

  const resetState = () => {
    setSelectedAnswer('');
    setIsChecking(false);
    setIsCorrect(false);
    setUserInput('');
    setLetterResults([]);
    setRevealedLetters(new Set());
    setAttemptCount(0);
    setShowCorrectAnswer(false);
  };

  const recordAnswer = (correct: boolean) => {
    setIsCorrect(correct);
    setIsChecking(true);
    setResults(prev => [...prev, correct]);
    // 答对 → 立即标记为已解决，移出待攻克；答错 → 记录错误
    const q = questions[currentIndex];
    if (q?.word_id) {
      submitMistakePracticeRecord(q.word_id, correct).catch(() => {});
    }
  };

  const handleNext = () => {
    if (currentIndex >= questions.length - 1) {
      setShowResult(true);
    } else {
      setCurrentIndex(i => i + 1);
      resetState();
    }
  };

  const renderQuiz = (q: MixedQuestion) => (
    <>
      <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-800 mb-6">{q.question}</h2>
        <div className="space-y-3">
          {q.options?.map((option, idx) => {
            const isSelected = selectedAnswer === option;
            const isCorrectOpt = option === q.correct_answer;
            let style = 'bg-gray-50 border-gray-200 hover:border-orange-300 hover:bg-orange-50';
            if (isChecking) {
              if (isCorrectOpt) style = 'bg-green-50 border-green-400 text-green-800';
              else if (isSelected && !isCorrect) style = 'bg-red-50 border-red-400 text-red-800';
              else style = 'bg-gray-50 border-gray-200 opacity-50';
            } else if (isSelected) style = 'bg-orange-50 border-orange-400';
            return (
              <motion.button
                key={idx}
                onClick={() => {
                  if (isChecking) return;
                  setSelectedAnswer(option);
                  recordAnswer(option === q.correct_answer);
                }}
                disabled={isChecking}
                animate={isChecking && isSelected && !isCorrect ? { x: [0, -8, 8, -8, 8, 0] } : {}}
                transition={{ duration: 0.4 }}
                className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${style}`}
              >
                <span className="font-medium">{String.fromCharCode(65 + idx)}. {option}</span>
                {isChecking && isCorrectOpt && <span className="float-right text-green-500">✓</span>}
                {isChecking && isSelected && !isCorrect && !isCorrectOpt && <span className="float-right text-red-500">✗</span>}
              </motion.button>
            );
          })}
        </div>
      </div>
    </>
  );

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
                  <span className="border-b-2 border-orange-400 px-4 py-0.5 inline-block">
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

  const renderFillblank = (q: MixedQuestion) => (
    <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
      <div className="bg-gradient-to-r from-orange-50 to-yellow-50 rounded-xl p-5 mb-6 border border-orange-200">
        <p className="text-xl text-gray-800 leading-relaxed">
          {q.question && renderSentence(q.question)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {q.options?.map((option, idx) => {
          const isSelected = selectedAnswer === option;
          const isCorrectOpt = option === q.correct_answer;
          let style = 'bg-white border-gray-200 hover:border-orange-300 hover:shadow-md';
          if (isChecking) {
            if (isCorrectOpt) style = 'bg-green-50 border-green-400 text-green-800';
            else if (isSelected && !isCorrect) style = 'bg-red-50 border-red-400 text-red-800';
            else style = 'bg-gray-50 border-gray-200 opacity-50';
          }
          return (
            <motion.button
              key={idx}
              onClick={() => {
                if (isChecking) return;
                setSelectedAnswer(option);
                recordAnswer(option === q.correct_answer);
              }}
              disabled={isChecking}
              whileHover={!isChecking ? { scale: 1.03 } : {}}
              whileTap={!isChecking ? { scale: 0.97 } : {}}
              className={`p-4 rounded-xl border-2 font-bold text-center text-lg shadow-sm transition-colors ${style}`}
            >
              {option}
              {isChecking && isCorrectOpt && <span className="ml-1">✓</span>}
              {isChecking && isSelected && !isCorrect && !isCorrectOpt && <span className="ml-1">✗</span>}
            </motion.button>
          );
        })}
      </div>
    </div>
  );

  const handleHint = (answer: string) => {
    for (let i = 0; i < answer.length; i++) {
      if (answer[i] === ' ') continue;
      if (!revealedLetters.has(i)) {
        setRevealedLetters(prev => new Set(prev).add(i));
        break;
      }
    }
  };

  const handleCheck = (q: MixedQuestion) => {
    const answer = q.correct_answer.trim();
    const input = userInput.trim();
    const correct = input === answer;
    const compareResults: string[] = [];
    for (let i = 0; i < answer.length; i++) {
      if (i < input.length) compareResults.push(input[i] === answer[i] ? 'correct' : 'wrong');
      else compareResults.push('missing');
    }
    setLetterResults(compareResults);
    if (correct) {
      recordAnswer(true);
    } else {
      const newCount = attemptCount + 1;
      setAttemptCount(newCount);
      if (newCount >= 3) {
        setShowCorrectAnswer(true);
        recordAnswer(false);
      }
    }
  };

  const renderSpelling = (q: MixedQuestion) => {
    const answer = q.correct_answer;
    const letters = answer.split('');
    return (
      <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
        <div className="text-center mb-6">
          <button
            onClick={() => playAudio(q.word)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition mb-2"
          >
            🔊 {q.word}
            {q.phonetic && <ColoredPhonetic phonetic={q.phonetic} className="text-sm" />}
          </button>
          <p className="text-gray-500 text-sm">{q.meaning}</p>
        </div>

        <div
          className="flex flex-wrap gap-1 justify-center mb-6"
          onClick={() => hiddenInputRef.current?.focus()}
        >
          {letters.map((letter, i) => {
            if (letter === ' ') return <div key={i} className="w-3" />;
            const typed = userInput[i] || '';
            const result = letterResults[i];
            const isRevealed = revealedLetters.has(i);
            let bg = 'bg-gray-100 border-gray-300';
            if (result === 'correct') bg = 'bg-green-100 border-green-400 text-green-700';
            else if (result === 'wrong') bg = 'bg-red-100 border-red-400 text-red-700';
            else if (result === 'missing') bg = 'bg-gray-50 border-red-200';
            else if (isRevealed) bg = 'bg-yellow-100 border-yellow-400 text-yellow-700';
            return (
              <div key={i} className={`w-9 h-10 border-2 rounded-lg flex items-center justify-center font-bold text-lg ${bg}`}>
                {isRevealed ? letter : (typed || '')}
              </div>
            );
          })}
        </div>

        <input
          ref={hiddenInputRef}
          value={userInput}
          onChange={e => {
            if (!isChecking) {
              setUserInput(e.target.value);
              setLetterResults([]);
            }
          }}
          onKeyDown={e => { if (e.key === 'Enter' && !isChecking && userInput.trim()) handleCheck(q); }}
          className="opacity-0 absolute w-0 h-0"
          disabled={isChecking}
          autoFocus
        />

        {showCorrectAnswer && (
          <p className="text-center text-gray-500 mb-4">正确答案：<span className="font-bold text-green-600">{answer}</span></p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => handleHint(answer)}
            disabled={isChecking}
            className="flex-1 flex items-center justify-center gap-1 py-3 bg-yellow-50 text-yellow-700 rounded-xl border border-yellow-200 hover:bg-yellow-100 transition disabled:opacity-50"
          >
            <Lightbulb className="w-4 h-4" /> 提示
          </button>
          <button
            onClick={() => handleCheck(q)}
            disabled={isChecking || !userInput.trim()}
            className="flex-1 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition disabled:opacity-50"
          >
            {attemptCount > 0 ? `再试 (${3 - attemptCount}次)` : '检查'}
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4" />
          <p className="text-gray-500">生成混合题目中...</p>
        </div>
      </div>
    );
  }

  if (showResult) {
    const correctCount = results.filter(Boolean).length;
    const wrongWords = questions.filter((_, i) => !results[i]);
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 p-4">
        <div className="max-w-lg mx-auto pt-12">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl shadow-xl p-8 text-center">
            <div className="text-6xl mb-4">{correctCount / questions.length >= 0.8 ? '🎉' : '💪'}</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">练习完成！</h2>
            <p className="text-4xl font-bold text-primary mb-1">{correctCount}/{questions.length}</p>
            <p className="text-gray-500 mb-6">正确率 {Math.round(correctCount / questions.length * 100)}%</p>
            {wrongWords.length > 0 && (
              <div className="text-left bg-red-50 rounded-xl p-4 mb-6">
                <p className="font-bold text-red-700 mb-2">需要加强的词：</p>
                {wrongWords.map(w => (
                  <div key={w.word_id} className="flex justify-between text-sm py-1 border-b border-red-100 last:border-0">
                    <span className="font-medium text-gray-800">{w.word}</span>
                    <span className="text-gray-500">{w.meaning}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { resetState(); setCurrentIndex(0); setResults([]); setShowResult(false); }}
                className="flex-1 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition"
              >
                再练一次
              </button>
              <button
                onClick={() => navigate('/student/mistake-book')}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition"
              >
                返回错题集
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIndex];
  const pct = Math.round(((currentIndex + 1) / questions.length) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      <nav className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700">错题练习</span>
              <span className="text-sm text-gray-500">{currentIndex + 1} / {questions.length}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-primary to-yellow-400 rounded-full"
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${TYPE_COLORS[currentQ.type]}`}>
            {TYPE_LABELS[currentQ.type]}
          </span>
        </div>
      </nav>

      <div className="max-w-lg mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
          >
            {currentQ.type === 'quiz' && renderQuiz(currentQ)}
            {currentQ.type === 'fillblank' && renderFillblank(currentQ)}
            {currentQ.type === 'spelling' && renderSpelling(currentQ)}
          </motion.div>
        </AnimatePresence>

        <AnimatePresence>
          {isChecking && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <AnswerFeedback
                isCorrect={isCorrect}
                word={currentQ.word}
                phonetic={currentQ.phonetic}
                meaning={currentQ.meaning}
                correctAnswer={currentQ.correct_answer}
                userAnswer={!isCorrect ? (currentQ.type === 'spelling' ? userInput : selectedAnswer) : undefined}
                onNext={handleNext}
                isLast={currentIndex >= questions.length - 1}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default MistakePractice;
