import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { createLearningRecords, reportStudyTime } from '../api/learningRecords';
import { submitHomeworkAttempt, getMyHomework } from '../api/homework';
import { toast } from '../components/Toast';
import useNetActiveTime from './useNetActiveTime';
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

  // 计时口径统一走 useNetActiveTime:发呆/切屏整段不计(含判定前的 60 秒)
  const { idle: isIdle, netSeconds, takeDelta } = useNetActiveTime();

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

  // 计时器：每秒把净活动时长同步进 state 供界面显示(发呆/切屏时 netSeconds 自然不涨)
  useEffect(() => {
    const timer = setInterval(() => setTimeSpent(netSeconds()), 1000);
    return () => clearInterval(timer);
  }, [netSeconds]);

  // 退出补尾巴:最后一题提交之后到离开页面这段净活动时长,原先整段丢失
  // (做了几题就退出很常见)。走纯时长端点,不产生学习记录。
  const takeDeltaRef = useRef(takeDelta);
  takeDeltaRef.current = takeDelta;
  useEffect(() => () => {
    const tail = takeDeltaRef.current();
    if (tail > 0) reportStudyTime(tail).catch(() => {});
  }, []);

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
      const net = netSeconds();
      const deltaSec = Math.max(0, net - lastRecordedSecRef.current);
      lastRecordedSecRef.current = net;
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
        // 日历时长走净活动增量。此前拼写/选择/填空三个模式**从不传这个字段**,
        // 后端只能退回按逐题 time_spent 累加(旧客户端兼容路径),日历时长因此偏差。
        session_seconds: deltaSec,
      }).catch(() => {}); // 静默失败，不影响答题体验
    }
  }, [currentIndex, questions, unitId, mode, netSeconds]);

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
            // 这次达标刚好把当天任务全部做完 → 系统已自动发金币
            if (r.coin_awarded) {
              setTimeout(() => toast.success('🪙 今天的任务全部完成,金币 +1!'), 900);
            } else if (r.is_passed && r.coin_hint?.message) {
              // 达标但没发币:主动说清为什么(补做/已发过/还差几份/手动模式),
              // 不然每个"完成了没加币"都会变成一次找老师问规则
              const msg = r.coin_hint.message;
              setTimeout(() => toast(`🪙 ${msg}`, 'info'), 900);
            }
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
