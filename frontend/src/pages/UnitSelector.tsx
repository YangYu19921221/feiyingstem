import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getBookProgress } from '../api/progress';
import type { BookProgress } from '../api/progress';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { toast } from '../components/Toast';

const DAILY_GOAL = 10;

const UnitSelector = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [bookProgress, setBookProgress] = useState<BookProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  const [expandedUnitId, setExpandedUnitId] = useState<number | null>(null);

  useEffect(() => {
    if (bookId) {
      loadBookProgress(parseInt(bookId));
    }
  }, [bookId]);

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

  const handleStartLearning = (unitId: number, mode: string, unitIndex: number) => {
    // 第一个单元总是可以进入；后续单元要求前一个有学习进度
    if (unitIndex > 0) {
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
  ];

  const sortedUnits = bookProgress
    ? [...bookProgress.units].sort((a, b) => (a.unit_number || 0) - (b.unit_number || 0))
    : [];

  const firstIncompleteIndex = sortedUnits.findIndex(u => !u.is_completed);

  return (
    <div className="min-h-screen bg-paper">
      {/* 顶部导航 */}
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 py-3.5 flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-1.5 -ml-1.5 text-ink-soft hover:text-ink hover:bg-black/5 rounded-md transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="font-display text-base font-semibold text-ink flex-1 truncate">{bookProgress.book_name}</h1>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-5 py-10">
        {/* Hero：书本信息 */}
        <section className="mb-10">
          <p className="text-ink-mute text-sm mb-2">{bookProgress.unit_count} 单元 · {bookProgress.word_count} 词</p>
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink leading-[1.1] tracking-tight mb-4">
            {bookProgress.book_name}
          </h2>
          <div className="flex items-baseline gap-3">
            <div className="flex-1 max-w-xs h-1 bg-black/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-warm rounded-full transition-all"
                style={{ width: `${bookProgress.progress_percentage}%` }}
              />
            </div>
            <span className="text-sm font-numeric text-ink-soft">
              <span className="font-semibold text-ink">{bookProgress.progress_percentage.toFixed(0)}%</span> 完成
            </span>
          </div>
        </section>

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
              const isLocked = index > 0 && !sortedUnits[index - 1].has_progress && !sortedUnits[index - 1].is_completed;

              return (
                <motion.div
                  key={unit.unit_id}
                  initial={!hasLoadedOnce.current ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, delay: !hasLoadedOnce.current ? Math.min(0.03 * index, 0.3) : 0 }}
                >
                  {/* 单元行 */}
                  <div
                    className={`flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-black/[0.02] transition ${isCurrent ? 'bg-accent-warm/[0.04]' : ''}`}
                    onClick={() => setExpandedUnitId(isExpanded ? null : unit.unit_id)}
                  >
                    {/* 序号 */}
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold font-numeric shrink-0 ${
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
                          <span className="px-1.5 py-0.5 bg-accent-warm text-white text-[10px] rounded font-medium">
                            当前
                          </span>
                        )}
                        {unit.is_perfect && (
                          <span className="px-1.5 py-0.5 bg-black/[0.06] text-ink-soft text-[10px] rounded font-medium">
                            ⭐ 满分
                          </span>
                        )}
                        {!unit.is_perfect && unit.best_accuracy !== null && unit.best_accuracy !== undefined && (
                          <span className="px-1.5 py-0.5 text-ink-mute text-[10px] font-numeric">
                            最佳 {unit.best_accuracy.toFixed(0)}%
                          </span>
                        )}
                        {(unit.attempt_count || 0) > 0 && (
                          (() => {
                            const n = unit.attempt_count!;
                            if (n >= 5) {
                              // 高手：金色流光胶囊
                              return (
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-numeric font-semibold text-white progress-gold shrink-0 inline-flex items-center gap-0.5">
                                  ⟳ {n} 轮
                                </span>
                              );
                            }
                            if (n >= 2) {
                              // 多次完成：实色橙
                              return (
                                <span className="px-2 py-0.5 rounded-full bg-accent-warm text-white text-[11px] font-numeric font-semibold shrink-0 inline-flex items-center gap-0.5">
                                  ⟳ {n} 轮
                                </span>
                              );
                            }
                            // 第一次：浅橙底
                            return (
                              <span className="px-2 py-0.5 rounded-full bg-accent-warm/15 text-accent-warm text-[11px] font-numeric font-semibold shrink-0 inline-flex items-center gap-0.5">
                                ✓ 1 轮
                              </span>
                            );
                          })()
                        )}
                      </div>
                      {/* 进度条 */}
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1 bg-black/[0.05] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              unit.is_completed ? 'bg-ink-soft' : 'bg-accent-warm'
                            }`}
                            style={{ width: `${Math.max(unit.progress_percentage, 0)}%` }}
                          />
                        </div>
                        <span className="text-xs text-ink-mute w-8 text-right font-numeric shrink-0">
                          {unit.progress_percentage.toFixed(0)}%
                        </span>
                      </div>
                    </div>

                    {/* 右侧按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartLearning(unit.unit_id, 'classify', index);
                      }}
                      disabled={isLocked}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition shrink-0 active:scale-95 ${
                        isLocked
                          ? 'text-ink-mute cursor-not-allowed'
                          : isCurrent
                          ? 'bg-accent-warm text-white hover:opacity-90'
                          : 'border border-black/15 text-ink hover:bg-black/5'
                      }`}
                    >
                      {isLocked ? '🔒' : '学习'}
                    </button>

                    <ChevronDown className={`w-4 h-4 text-ink-mute transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>

                  {/* 展开详情 */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
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
                                <div className="h-1.5 bg-black/[0.05] rounded-full overflow-hidden mb-2">
                                  <div
                                    className="h-full bg-accent-warm rounded-full transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
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
                                  {unit.best_accuracy !== null && unit.best_accuracy !== undefined ? `${unit.best_accuracy.toFixed(0)}%` : '—'}
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
                            <div className="mb-4 px-3 py-2.5 border-l-2 border-accent-warm bg-white rounded-r-md text-sm">
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
                            <div className="mb-4 px-3 py-2.5 border-l-2 border-black/15 bg-white rounded-r-md text-sm text-ink-soft">
                              已完成，可重新复习巩固
                            </div>
                          )}

                          {/* 其他学习模式 */}
                          <p className="text-xs text-ink-mute mb-2">其他学习模式</p>
                          <div className="grid grid-cols-3 gap-2">
                            {learningModes.filter(m => m.key !== 'classify').map((mode) => (
                              <button
                                key={mode.key}
                                onClick={() => handleStartLearning(unit.unit_id, mode.key, index)}
                                disabled={isLocked}
                                className={`relative py-2.5 px-2 rounded-lg text-sm font-medium transition active:scale-95 ${
                                  isLocked
                                    ? 'text-ink-mute cursor-not-allowed'
                                    : 'bg-white border border-black/[0.08] text-ink hover:border-black/20 hover:bg-black/[0.02]'
                                }`}
                              >
                                {mode.name}
                                {mode.badge && (
                                  <span className="ml-1 text-[10px] text-ink-mute font-normal">
                                    {mode.badge}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
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
