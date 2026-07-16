import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { createLearningRecords } from '../api/learningRecords';
import { submitHomeworkAttempt, getMyHomework } from '../api/homework';
import { toast } from '../components/Toast';
import useIdleDetector from './useIdleDetector';
import usePresence from './usePresence';

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
  const location = useLocation();
  // 从「老师布置的任务/我的作业」进来时带 assignmentId,完成后回传成绩(拼写/填空/选择题作业共用)
  const homeworkAssignmentId: number | null =
    (location.state as any)?.fromHomework ? ((location.state as any)?.assignmentId ?? null) : null;
  // 兜底:学生不从任务入口、自己点进单元做同模式练习,也要算作业完成。
  // 查本单元同模式的待办作业,做完同样交卷(否则作业管理页永远没数据)。
  const [unitTaskId, setUnitTaskId] = useState<number | null>(null);
  useEffect(() => {
    if (homeworkAssignmentId || !unitId) return;
    getMyHomework()
      .then(all => {
        const t = all.find(h =>
          h.unit_id === parseInt(unitId) &&
          h.learning_mode === mode &&
          (h.status === 'pending' || h.status === 'in_progress'));
        setUnitTaskId(t?.id ?? null);
      })
      .catch(() => {});
  }, [unitId, mode, homeworkAssignmentId]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const [timeSpent, setTimeSpent] = useState(0);
  // 已计入后端的累计秒数：每题只上报"本题增量"，避免每条记录都传整场累计时长导致时长成倍虚高
  const lastRecordedSecRef = useRef(0);
  const [wrongAnswers, setWrongAnswers] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<(boolean | null)[]>([]);

  const isIdle = useIdleDetector();

  // 实时课堂:练习页(拼写/填空/选择题)也上报在线状态,否则老师端显示离线
  usePresence({
    unitId: unitId ? parseInt(unitId) : undefined,
    unitName,
    idle: isIdle,
    enabled: questions.length > 0,
  });

  // 初始化 results 数组
  useEffect(() => {
    if (questions.length > 0) {
      setResults(new Array(questions.length).fill(null));
    }
  }, [questions.length]);

  // 计时器：空闲时暂停（无键盘/鼠标操作60秒 或 标签页隐藏）
  useEffect(() => {
    if (isIdle) return;
    const timer = setInterval(() => setTimeSpent(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [isIdle]);

  const answered = results.filter(r => r !== null).length;
  const accuracy = answered > 0 ? Math.round((score / answered) * 100) : 0;

  const formatTime = useCallback((s: number) => {
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  }, []);

  const recordAnswer = useCallback((correct: boolean, userAnswer?: string) => {
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
      // 只上报本题增量耗时（本次累计 − 上次已记录），所有增量之和 = 整场实际时长
      const deltaSec = Math.max(0, timeSpent - lastRecordedSecRef.current);
      lastRecordedSecRef.current = timeSpent;
      createLearningRecords({
        unit_id: parseInt(unitId),
        learning_mode: mode,
        records: [{
          word_id: q.word_id,
          is_correct: correct,
          time_spent: deltaSec * 1000,
          learning_mode: mode,
          // 答错时的真实输入(拼写模式携带),拼写错误诊断的数据源
          user_answer: !correct && userAnswer ? userAnswer : undefined,
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
      // 作业模式:完成即交卷(百分制),让作业状态/最佳分/尝试次数更新。
      // 交卷目标:任务入口带来的 id 优先,否则用本单元同模式的待办任务(自主进入兜底)
      const submitId = homeworkAssignmentId ?? unitTaskId;
      if (submitId) {
        const finalScore = Math.round((score / Math.max(questions.length, 1)) * 100);
        submitHomeworkAttempt(submitId, {
          score: finalScore,
          time_spent: Math.max(1, timeSpent),
          correct_count: score,
          wrong_count: questions.length - score,
          total_words: questions.length,
        })
          .then(r => {
            toast.success(r.is_passed
              ? `🎉 作业达标!得分 ${r.score}`
              : `作业已提交,得分 ${r.score}(目标未达,还可再试 ${r.remaining_attempts} 次)`);
          })
          .catch(err => console.error('提交作业成绩失败:', err));
      }
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
  }, [currentIndex, questions, wrongAnswers, mode, modeName, score, timeSpent, unitId, unitName, totalUnitWords, navigate, homeworkAssignmentId, unitTaskId]);

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
