import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createLearningRecords } from '../api/learningRecords';

export interface PracticeResult {
  correct: boolean | null;
}

export interface WeakWord {
  word: string;
  meaning: string;
  attempts: number;
}

export interface CompletionNavState {
  mode: string;
  modeName: string;
  score: number;
  total: number;
  timeSpent: number;
  weakWords: WeakWord[];
  unitId: number;
  unitName?: string;
  totalUnitWords?: number;
}

interface UsePracticeStateOptions {
  mode: string;
  modeName: string;
  unitId: string | undefined;
  questions: Array<{ word: string; word_id?: number; question: string; correct_answer: string }>;
  unitName?: string;
  totalUnitWords?: number;
}

export function usePracticeState({
  mode,
  modeName,
  unitId,
  questions,
  unitName,
  totalUnitWords,
}: UsePracticeStateOptions) {
  const navigate = useNavigate();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const [timeSpent, setTimeSpent] = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<(boolean | null)[]>([]);

  // 初始化 results 数组
  useEffect(() => {
    if (questions.length > 0) {
      setResults(new Array(questions.length).fill(null));
    }
  }, [questions.length]);

  // 计时器
  useEffect(() => {
    const timer = setInterval(() => setTimeSpent(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const answered = results.filter(r => r !== null).length;
  const accuracy = answered > 0 ? Math.round((score / answered) * 100) : 0;

  const formatTime = useCallback((s: number) => {
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  }, []);

  const recordAnswer = useCallback((correct: boolean) => {
    setIsChecking(true);
    setIsCorrect(correct);
    setResults(prev => {
      const next = [...prev];
      next[currentIndex] = correct;
      return next;
    });
    if (correct) {
      setScore(s => s + 1);
    } else {
      setWrongAnswers(prev => new Set(prev).add(currentIndex));
    }

    // 实时提交学习记录到后端（错题会自动进入错题集）
    const q = questions[currentIndex];
    if (q?.word_id && unitId) {
      createLearningRecords({
        unit_id: parseInt(unitId),
        learning_mode: mode,
        records: [{
          word_id: q.word_id,
          is_correct: correct,
          time_spent: timeSpent * 1000,
          learning_mode: mode,
        }],
      }).catch(() => {}); // 静默失败，不影响答题体验
    }
  }, [currentIndex, questions, unitId, mode, timeSpent]);

  const goToNext = useCallback((resetExtra?: () => void) => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(i => i + 1);
      setIsChecking(false);
      setIsCorrect(null);
      resetExtra?.();
    } else {
      // 导航到完成页
      const weakWords = Array.from(wrongAnswers).map(idx => ({
        word: questions[idx].word,
        meaning: questions[idx].question,
        attempts: 1,
      }));
      const navState: CompletionNavState = {
        mode,
        modeName,
        score,
        total: questions.length,
        timeSpent,
        weakWords,
        unitId: parseInt(unitId || '0'),
        unitName,
        totalUnitWords,
      };
      navigate('/student/completion', { state: navState });
    }
  }, [currentIndex, questions, wrongAnswers, mode, modeName, score, timeSpent, unitId, unitName, totalUnitWords, navigate]);

  return {
    currentIndex,
    isChecking,
    isCorrect,
    score,
    timeSpent,
    wrongAnswers,
    results,
    answered,
    accuracy,
    formatTime,
    recordAnswer,
    goToNext,
  };
}
