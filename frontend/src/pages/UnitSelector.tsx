import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { getBookProgress } from '../api/progress';
import type { BookProgress } from '../api/progress';
import { getMyHomework, startHomework } from '../api/homework';
import type { StudentHomeworkResponse } from '../api/homework';
import { ArrowLeft, BookOpenText, ChevronDown, ClipboardCheck, LockKeyhole, Medal, PenLine } from 'lucide-react';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';
import FullscreenBookComplete from '../components/challenge-fx/FullscreenBookComplete';
import AnimatedProgress from '../components/student/AnimatedProgress';

const DAILY_GOAL = 10;

const MODE_LABELS: Record<string, string> = {
  flashcard: '闪卡', classify: '分类', dictation: '听写', sentencefill: '填句',
  quiz: '测试', spelling: '拼写', fillblank: '选词', handwriting: '纸笔听写',
};

const UnitSelector = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [searchParams] = useSearchParams();
  // 「我的作业」单元级分配跳转过来时定位到指定单元
  const focusUnitId = searchParams.get('focus') ? parseInt(searchParams.get('focus')!) : null;
  const [bookProgress, setBookProgress] = useState<BookProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  const hasFocused = useRef(false);
  const [expandedUnitId, setExpandedUnitId] = useState<number | null>(null);
  const [showBookComplete, setShowBookComplete] = useState(false);
  // 老师布置的任务(本书未完成的作业),常驻在单元列表上方
  const [bookTasks, setBookTasks] = useState<StudentHomeworkResponse[]>([]);

  useEffect(() => {
    if (bookId) {
      loadBookProgress(parseInt(bookId));
    }
  }, [bookId]);

  // 拉本书的待办作业:pending/in_progress 都算「今日任务」;失败静默不影响主流程
  useEffect(() => {
    let cancelled = false;
    getMyHomework()
      .then((all) => {
        if (cancelled || !bookProgress) return;
        const unitIds = new Set(bookProgress.units.map(u => u.unit_id));
        // 排掉未开放的当日任务:接口现在会返回它们(作业页要展示"明天做什么"),
        // 但这里是「今日任务」入口,点了也做不了,不能混进来
        setBookTasks(
          all.filter(h => unitIds.has(h.unit_id) && !h.is_locked &&
            (h.status === 'pending' || h.status === 'in_progress'))
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookProgress]);

  const handleStartTask = async (task: StudentHomeworkResponse) => {
    try {
      const result = await startHomework(task.id);
      navigate(`/student/units/${result.unit_id}/${result.learning_mode}`, {
        state: { fromHomework: true, assignmentId: task.id },
      });
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '开始作业失败'));
    }
  };

  // 整本书 100% 完成 → 一次性全屏庆祝（每本书每个学生只触发一次）
  useEffect(() => {
    if (!bookProgress || !bookId) return;
    if (bookProgress.progress_percentage < 100) return;
    const key = `book-complete-fx-${bookId}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    setShowBookComplete(true);
  }, [bookProgress, bookId]);

  const loadBookProgress = async (id: number) => {
    try {
      setLoading(true);
      const data = await getBookProgress(id);
      setBookProgress(data);
    } catch (error) {
      console.error('加载单词本进度失败:', error);
    } finally {
      setLoading(false);
      hasLoadedOnce.current = true;
    }
  };

  const formatStudyTime = (s: number) => {
    if (!s) return '--';
    return s >= 60 ? `${Math.floor(s / 60)}分${s % 60}秒` : `${s}秒`;
  };

  // 严格模式:后端 is_allowed=false 的单元未被分配,锁定不可学。
  // 白名单模式(存在锁定单元)下,被分配的单元不受「前一单元完成」顺序约束——老师点名的直接可学。
  const whitelistMode = (bookProgress?.units ?? []).some(u => u.is_allowed === false);
  // 有待办作业的单元:豁免顺序锁(老师点名的单元直接可学,即使前面单元没学完)
  const taskUnitIds = new Set(bookTasks.map(t => t.unit_id));

  // ?focus= 定位:数据加载后自动展开并滚动到指定单元(只执行一次)
  useEffect(() => {
    if (!bookProgress || !focusUnitId || hasFocused.current) return;
    hasFocused.current = true;
    setExpandedUnitId(focusUnitId);
    // 等待列表渲染完成后滚动定位
    setTimeout(() => {
      document.getElementById(`unit-row-${focusUnitId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }, [bookProgress, focusUnitId]);

  const handleStartLearning = (unitId: number, mode: string, unitIndex: number) => {
    const unit = sortedUnits[unitIndex];
    // 未分配的单元锁定
    if (unit && unit.is_allowed === false) {
      toast.warning('这个单元还没有分配,请联系老师');
      return;
    }
    // 顺序解锁只在整本可学时生效;白名单模式或有作业的单元直接可学
    if (!whitelistMode && !taskUnitIds.has(unitId) && unitIndex > 0) {
      const prevUnit = sortedUnits[unitIndex - 1];
      if (!prevUnit.has_progress && !prevUnit.is_completed) {
        toast.warning('请先完成上一个单元的学习');
        return;
      }
    }
    navigate(`/student/units/${unitId}/${mode}`);
  };

  const handleBack = () => {
    navigate('/student/dashboard');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-ink-mute text-sm">加载中…</p>
      </div>
    );
  }

  if (!bookProgress) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="text-center max-w-xs">
          <p className="text-ink-soft mb-4">加载失败</p>
          <button
            onClick={handleBack}
            className="px-5 py-2 border border-black/15 text-ink rounded-lg text-sm font-medium hover:bg-black/5 transition"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  const learningModes = [
    { key: 'classify', name: '分类', requiresPrevious: null },
    { key: 'dictation', name: '听写', requiresPrevious: 'classify' },
    { key: 'sentencefill', name: '填句', requiresPrevious: 'classify' },
    { key: 'quiz', name: '测试', badge: 'AI', requiresPrevious: 'classify' },
    { key: 'spelling', name: '拼写', badge: 'AI', requiresPrevious: 'quiz' },
    { key: 'fillblank', name: '选词', badge: 'AI', requiresPrevious: 'spelling' },
    { key: 'exam', name: '考试', badge: '测验', requiresPrevious: 'classify' },
    { key: 'handwriting', name: '手写听写', badge: 'AI', requiresPrevious: 'classify' },
    { key: 'handwriting-sheet', name: '打印默写纸', requiresPrevious: 'classify' },
  ];
  const foundationModes = learningModes.filter((mode) => ['dictation', 'sentencefill', 'quiz'].includes(mode.key));
  const challengeModes = learningModes.filter((mode) => ['spelling', 'fillblank', 'exam'].includes(mode.key));
  const paperModes = learningModes.filter((mode) => ['handwriting', 'handwriting-sheet'].includes(mode.key));

  const sortedUnits = bookProgress
    ? [...bookProgress.units].sort((a, b) => (a.unit_number || 0) - (b.unit_number || 0))
    : [];

  // 「当前」单元:第一个未完成且可学的单元
  const firstIncompleteIndex = sortedUnits.findIndex(u => !u.is_completed && u.is_allowed !== false);

  return (
    <div className="min-h-screen bg-paper">
      {showBookComplete && bookProgress && (
        <FullscreenBookComplete
          bookName={bookProgress.book_name}
          onComplete={() => setShowBookComplete(false)}
        />
      )}
      {/* 顶部导航 */}
      <nav className="border-b border-slate-200/80 bg-white/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 py-3.5 flex items-center gap-3">
          <button
            onClick={handleBack}
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft transition hover:bg-black/5 hover:text-ink"
            aria-label="返回"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="font-display text-base font-semibold text-ink flex-1 truncate">{bookProgress.book_name}</h1>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-5 py-10">
        {/* Hero：书本信息 */}
        <section className="mb-10">
          {(bookProgress.grade_level || bookProgress.volume) && (
            <div className="inline-flex items-center gap-1.5 mb-3 px-2.5 py-0.5 rounded-full bg-accent-warm/[0.10] text-accent-warm text-xs font-medium">
              {bookProgress.grade_level && <span>{bookProgress.grade_level}</span>}
              {bookProgress.grade_level && bookProgress.volume && <span className="opacity-50">·</span>}
              {bookProgress.volume && <span>{bookProgress.volume}</span>}
            </div>
          )}
          <p className="text-ink-mute text-sm mb-2">{bookProgress.unit_count} 单元 · {bookProgress.word_count} 词</p>
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink leading-[1.1] tracking-tight mb-4">
            {bookProgress.book_name}
          </h2>
          <div className="flex items-baseline gap-3">
            <div className="flex-1 max-w-xs">
              <AnimatedProgress percent={bookProgress.progress_percentage} trackClassName="bg-black/[0.06]" />
            </div>
            <span className="text-sm font-numeric text-ink-soft">
              <span className="font-semibold text-ink">{bookProgress.progress_percentage.toFixed(0)}%</span> 完成
            </span>
          </div>
        </section>

        {/* 老师布置的任务:常驻显示,完成后自动消失 */}
        {bookTasks.length > 0 && (
          <section className="mb-8">
            <div className="overflow-hidden rounded-2xl border border-accent-warm/30 bg-accent-warm/[0.06]">
              <div className="px-5 py-3 flex items-center gap-2 border-b border-accent-warm/20">
                <ClipboardCheck className="h-4 w-4 text-accent-warm" aria-hidden="true" />
                <h3 className="font-semibold text-ink text-sm">老师布置的任务</h3>
                <span className="rounded-full bg-accent-warm px-2 py-0.5 font-numeric text-xs font-semibold text-white">
                  {bookTasks.length}
                </span>
                <span className="ml-auto text-xs text-ink-mute">完成后自动消失</span>
              </div>
              <div className="divide-y divide-accent-warm/10">
                {bookTasks.map((task) => {
                  const overdue = task.deadline && new Date(task.deadline) < new Date();
                  return (
                    <div key={task.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <BookOpenText className="mt-0.5 h-5 w-5 shrink-0 text-accent-warm" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">
                            {task.title}
                            <span className="ml-2 rounded bg-black/[0.05] px-2 py-0.5 text-xs text-ink-soft">
                              {MODE_LABELS[task.learning_mode] || task.learning_mode}
                            </span>
                          </p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-mute">
                            <span>{task.unit_name}</span>
                            <span>目标 {task.target_score} 分</span>
                          {task.deadline && (
                            <span className={overdue ? 'text-red-500 font-semibold' : ''}>
                                {overdue ? '已逾期' : `截止 ${new Date(task.deadline).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`}
                            </span>
                          )}
                            {task.attempts_count > 0 && <span>已试 {task.attempts_count}/{task.max_attempts} 次</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleStartTask(task)}
                        className={`min-h-11 w-full shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition active:scale-95 sm:w-auto ${
                          overdue
                            ? 'bg-red-500 text-white hover:opacity-90'
                            : 'bg-accent-warm text-white hover:opacity-90'
                        }`}
                      >
                        {task.status === 'in_progress' ? '继续完成' : '去完成'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* 单元列表 */}
        {bookProgress.units.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-black/10 rounded-2xl">
            <p className="text-ink-soft mb-1">该单词本还没有单元</p>
            <p className="text-xs text-ink-mute">等待老师添加</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-black/[0.05] overflow-hidden divide-y divide-black/[0.05]">
            {sortedUnits.map((unit, index) => {
              const isExpanded = expandedUnitId === unit.unit_id;
              const isCurrent = index === firstIncompleteIndex;
              // 未分配 → 硬锁定;顺序解锁只在整本可学(非白名单)时生效;有作业的单元豁免顺序锁
              const isNotAllowed = unit.is_allowed === false;
              const hasTask = taskUnitIds.has(unit.unit_id);
              const isSeqLocked = !whitelistMode && !hasTask && index > 0 && !sortedUnits[index - 1].has_progress && !sortedUnits[index - 1].is_completed;
              const isLocked = isNotAllowed || isSeqLocked;

              return (
                <motion.div
                  key={unit.unit_id}
                  id={`unit-row-${unit.unit_id}`}
                  initial={!hasLoadedOnce.current && !reduceMotion ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2, delay: !hasLoadedOnce.current && !reduceMotion ? Math.min(0.03 * index, 0.3) : 0 }}
                  className={isNotAllowed ? 'opacity-55' : ''}
                >
                  {/* 单元行 */}
                  <div className={`flex items-stretch gap-2 px-3 py-2 sm:px-5 sm:py-3 ${isCurrent ? 'bg-accent-warm/[0.04]' : ''}`}>
                    <button
                      type="button"
                      onClick={() => setExpandedUnitId(isExpanded ? null : unit.unit_id)}
                      aria-expanded={isExpanded}
                      aria-controls={`unit-detail-${unit.unit_id}`}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-black/[0.025]"
                    >
                    {/* 序号 */}
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-numeric text-xs font-semibold ${
                      unit.is_completed
                        ? 'bg-black/[0.06] text-ink-soft'
                        : isCurrent
                        ? 'bg-accent-warm text-white'
                        : 'bg-black/[0.04] text-ink-mute'
                    }`}>
                      {unit.is_completed ? '✓' : unit.unit_number || index + 1}
                    </div>

                    {/* 单元信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="font-medium text-ink truncate">
                          {unit.unit_name}
                        </h3>
                        {isCurrent && (
                          <span className="rounded bg-accent-warm px-2 py-0.5 text-xs font-medium text-white">
                            当前
                          </span>
                        )}
                        {isNotAllowed && (
                          <span className="inline-flex items-center gap-1 rounded bg-black/[0.06] px-2 py-0.5 text-xs font-medium text-ink-mute">
                            <LockKeyhole className="h-3 w-3" aria-hidden="true" />
                            待老师分配
                          </span>
                        )}
                        {hasTask && (
                          <span className="inline-flex items-center gap-1 rounded bg-accent-warm/15 px-2 py-0.5 text-xs font-medium text-accent-warm">
                            <ClipboardCheck className="h-3 w-3" aria-hidden="true" />
                            有作业
                          </span>
                        )}
                        {unit.is_perfect && (
                          <span className="inline-flex items-center gap-1 rounded bg-black/[0.06] px-2 py-0.5 text-xs font-medium text-ink-soft">
                            <Medal className="h-3 w-3" aria-hidden="true" />
                            满分
                          </span>
                        )}
                        {!unit.is_perfect && unit.best_accuracy !== null && unit.best_accuracy !== undefined && (
                          <span className="px-1.5 py-0.5 text-xs font-numeric text-ink-mute">
                            最佳 {unit.best_accuracy.toFixed(0)}%
                          </span>
                        )}
                        {(unit.attempt_count || 0) > 0 && (
                          (() => {
                            const n = unit.attempt_count!;
                            if (n >= 5) {
                              // 高手：金色流光胶囊
                              return (
                                <span className="progress-gold inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-numeric text-xs font-semibold text-white">
                                  {n} 轮
                                </span>
                              );
                            }
                            if (n >= 2) {
                              // 多次完成：实色橙
                              return (
                                <span className="inline-flex shrink-0 items-center rounded-full bg-accent-warm px-2 py-0.5 font-numeric text-xs font-semibold text-white">
                                  {n} 轮
                                </span>
                              );
                            }
                            // 第一次：浅橙底
                            return (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-accent-warm/15 px-2 py-0.5 font-numeric text-xs font-semibold text-accent-warm">
                                1 轮
                              </span>
                            );
                          })()
                        )}
                      </div>
                      {/* 进度条 */}
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1">
                          <AnimatedProgress percent={unit.progress_percentage} />
                        </div>
                        <span className="text-xs text-ink-mute w-8 text-right font-numeric shrink-0">
                          {unit.progress_percentage.toFixed(0)}%
                        </span>
                      </div>
                    </div>

                    <ChevronDown className={`h-4 w-4 shrink-0 text-ink-mute transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>

                    {/* 纸笔听写直达:手机上藏起来(靠展开里的分组),避免行内按钮挤成一团 */}
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => handleStartLearning(unit.unit_id, 'handwriting', index)}
                        title="纸笔听写(手写拍照批改)"
                        aria-label="纸笔听写"
                        className="hidden sm:flex h-11 w-11 shrink-0 self-center items-center justify-center rounded-lg border border-black/[0.08] text-ink-soft transition hover:border-black/20 hover:bg-black/[0.02] active:scale-95"
                      >
                        <PenLine className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}

                    {/* 右侧按钮 */}
                    <button
                      type="button"
                      onClick={() => handleStartLearning(unit.unit_id, 'classify', index)}
                      disabled={isLocked}
                      className={`min-h-11 shrink-0 self-center rounded-lg px-3 py-2 text-sm font-medium transition active:scale-95 sm:px-4 ${
                        isLocked
                          ? 'text-ink-mute cursor-not-allowed'
                          : isCurrent
                          ? 'bg-accent-warm text-white hover:opacity-90'
                          : 'border border-black/15 text-ink hover:bg-black/5'
                      }`}
                    >
                      {isNotAllowed ? (
                        <span className="inline-flex items-center gap-1"><LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />待分配</span>
                      ) : isLocked ? (
                        <LockKeyhole className="h-4 w-4" aria-label="已锁定" />
                      ) : (
                        <><span className="sm:hidden">分类</span><span className="hidden sm:inline">分类学习</span></>
                      )}
                    </button>
                  </div>

                  {/* 展开详情 */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        id={`unit-detail-${unit.unit_id}`}
                        initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-5 pt-1 bg-black/[0.015]">
                          {/* 单元详情 */}
                          {(() => {
                            const remaining = unit.word_count - unit.completed_words;
                            const pct = unit.word_count > 0 ? Math.round((unit.completed_words / unit.word_count) * 100) : 0;
                            const todayGroups = Math.ceil(remaining / DAILY_GOAL);
                            return (
                              <div className="mb-4">
                                <div className="flex items-center justify-between text-sm mb-1.5">
                                  <span className="text-ink-soft">已掌握 <span className="font-numeric font-semibold text-ink">{unit.completed_words}/{unit.word_count}</span></span>
                                  <span className="text-ink-mute font-numeric">{pct}%</span>
                                </div>
                                <div className="mb-2">
                                  <AnimatedProgress percent={pct} heightClassName="h-1.5" />
                                </div>
                                {remaining > 0 && (
                                  <p className="text-xs text-ink-mute">
                                    每天学 {DAILY_GOAL} 个，约 <span className="font-numeric text-ink-soft">{todayGroups}</span> 天完成
                                  </p>
                                )}
                              </div>
                            );
                          })()}

                          {/* 学习成绩 */}
                          {unit.has_progress && (
                            <div className="grid grid-cols-2 gap-2 mb-4">
                              <div className="p-3 bg-white rounded-lg border border-black/[0.05]">
                                <p className="text-xs text-ink-mute mb-1">最佳成绩</p>
                                <p className="font-display text-lg font-semibold text-ink font-numeric">
                                  {unit.best_accuracy !== null && unit.best_accuracy !== undefined ? `${unit.best_accuracy.toFixed(0)}%` : '暂无'}
                                </p>
                              </div>
                              <div className="p-3 bg-white rounded-lg border border-black/[0.05]">
                                <p className="text-xs text-ink-mute mb-1">学习时间</p>
                                <p className="font-display text-lg font-semibold text-ink font-numeric">
                                  {formatStudyTime(unit.total_study_time || 0)}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* 断点续学 */}
                          {unit.has_progress && !unit.is_completed && (
                            <div className="mb-4 rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-black/[0.05]">
                              从第 <span className="font-numeric font-semibold text-ink">{unit.current_word_index + 1}</span> 个单词继续
                              {unit.last_studied_at && (
                                <span className="text-xs text-ink-mute ml-2">
                                  上次 {new Date(unit.last_studied_at).toLocaleString('zh-CN', {
                                    month: 'numeric',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: 'numeric'
                                  })}
                                </span>
                              )}
                            </div>
                          )}

                          {unit.is_completed && (
                            <div className="mb-4 rounded-xl bg-white px-3 py-2.5 text-sm text-ink-soft ring-1 ring-black/[0.05]">
                              已完成，可重新复习巩固
                            </div>
                          )}

                          {/* 其他模式分组，每组最多 3 个决策。 */}
                          {[
                            { title: '基础巩固', hint: '建议完成分类后再做', modes: foundationModes },
                            { title: '进阶挑战', hint: '想提高准确率时使用', modes: challengeModes },
                            { title: '纸笔听写', hint: '在纸上手写,拍照 AI 批改', modes: paperModes },
                          ].map((group) => (
                            <section key={group.title} className="mb-4 last:mb-0" aria-label={group.title}>
                              <div className="mb-2">
                                <p className="text-sm font-semibold text-ink">{group.title}</p>
                                <p className="mt-0.5 text-xs text-ink-mute">{group.hint}</p>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                {group.modes.map((mode) => (
                                  <button
                                    key={mode.key}
                                    type="button"
                                    onClick={() => handleStartLearning(unit.unit_id, mode.key, index)}
                                    disabled={isLocked}
                                    className={`relative min-h-11 rounded-lg px-2 py-2.5 text-sm font-medium transition active:scale-95 ${
                                      isLocked
                                        ? 'cursor-not-allowed text-ink-mute'
                                        : 'border border-black/[0.08] bg-white text-ink hover:border-black/20 hover:bg-black/[0.02]'
                                    }`}
                                  >
                                    {mode.name}
                                    {mode.badge && (
                                      <span className="ml-1 text-xs font-normal text-ink-mute">
                                        {mode.badge}
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default UnitSelector;
