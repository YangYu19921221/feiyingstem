import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  BookOpenText,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  GraduationCap,
} from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { getMyAssignments } from '../api/assignments';
import type { StudentBookAssignmentResponse } from '../api/assignments';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

const getDaysUntilDeadline = (deadline?: string): number | null => {
  if (!deadline) return null;
  const diffTime = new Date(deadline).getTime() - Date.now();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const formatDate = (dateString: string): string => new Date(dateString).toLocaleDateString('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const getStatusConfig = (assignment: StudentBookAssignmentResponse) => {
  if (assignment.is_completed) {
    return { label: '已完成', className: 'bg-emerald-50 text-emerald-700' };
  }
  if (assignment.progress_percentage > 0) {
    return { label: '进行中', className: 'bg-orange-50 text-accent-warm' };
  }
  return { label: '未开始', className: 'bg-slate-100 text-slate-600' };
};

export default function StudentAssignments() {
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');
  const [assignments, setAssignments] = useState<StudentBookAssignmentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllPriority, setShowAllPriority] = useState(false);
  const [showAllOther, setShowAllOther] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    const loadAssignments = async () => {
      try {
        setLoading(true);
        setAssignments(await getMyAssignments());
      } catch (error: unknown) {
        console.error('加载作业失败:', error);
        toast.error(getErrorMessage(error, '教材任务加载失败'));
      } finally {
        setLoading(false);
      }
    };

    void loadAssignments();
  }, []);

  const groupedAssignments = useMemo(() => {
    const ordered = [...assignments].sort((a, b) => {
      if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
      if ((a.progress_percentage > 0) !== (b.progress_percentage > 0)) {
        return a.progress_percentage > 0 ? -1 : 1;
      }
      const aDeadline = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
      const bDeadline = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
      return aDeadline - bDeadline;
    });

    const active = ordered.filter((assignment) => !assignment.is_completed);
    const priority = active.filter((assignment) => {
      const days = getDaysUntilDeadline(assignment.deadline);
      return assignment.progress_percentage > 0 || (days !== null && days <= 3);
    });
    const priorityIds = new Set(priority.map((assignment) => assignment.id));

    return {
      priority,
      other: active.filter((assignment) => !priorityIds.has(assignment.id)),
      completed: ordered.filter((assignment) => assignment.is_completed),
    };
  }, [assignments]);

  const openAssignment = (assignment: StudentBookAssignmentResponse) => {
    navigate(
      assignment.unit_id
        ? `/student/books/${assignment.book_id}/units?focus=${assignment.unit_id}`
        : `/student/books/${assignment.book_id}/units`,
    );
  };

  const renderAssignment = (assignment: StudentBookAssignmentResponse, index: number) => {
    const status = getStatusConfig(assignment);
    const days = getDaysUntilDeadline(assignment.deadline);
    const isOverdue = days !== null && days < 0;
    const isUrgent = days !== null && days >= 0 && days <= 3;
    const scope = assignment.scope_type === 'unit' || assignment.scope_type === 'group'
      ? `Unit ${assignment.unit_number ?? '?'}${assignment.unit_name ? ` · ${assignment.unit_name}` : ''}${
        assignment.scope_type === 'group' && assignment.group_index ? ` · 第 ${assignment.group_index} 组` : ''
      }`
      : '整本教材';

    return (
      <motion.article
        key={assignment.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: Math.min(index * 0.035, 0.2), ease: [0.16, 1, 0.3, 1] }}
        className="card-soft rounded-2xl p-4 sm:p-5"
      >
        <div className="flex items-start gap-4">
          <img
            src={`/book-cover-${(assignment.book_id % 4) + 1}.jpeg`}
            alt=""
            className="h-20 w-16 shrink-0 rounded-xl object-cover sm:h-24 sm:w-20"
            loading="lazy"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-display text-base font-semibold text-ink sm:text-lg">{assignment.book_name}</h3>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft sm:text-sm">
                  <BookOpenText className="h-3.5 w-3.5 shrink-0 text-accent-warm" aria-hidden="true" />
                  <span className="line-clamp-1">{scope}</span>
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                {status.label}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1.5">
                <GraduationCap className="h-3.5 w-3.5 text-accent-warm" aria-hidden="true" />
                {assignment.teacher_name}
              </span>
              {assignment.deadline ? (
                <span className={`inline-flex items-center gap-1.5 ${isOverdue || isUrgent ? 'font-semibold text-accent-warm' : ''}`}>
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                  {isOverdue ? '已到截止时间' : isUrgent ? `还剩 ${days} 天` : `截止 ${formatDate(assignment.deadline)}`}
                </span>
              ) : (
                <span>分配于 {formatDate(assignment.assigned_at)}</span>
              )}
              {/* 兑换卡状态标签 */}
              {assignment.grant_type === 'period' && assignment.days_left !== undefined && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                  assignment.days_left <= 3 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                }`}>
                  📅 剩余 {assignment.days_left} 天
                </span>
              )}
              {assignment.grant_type === 'times' && assignment.times_left !== undefined && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                  assignment.times_left <= 3 ? 'bg-red-50 text-red-600' : 'bg-purple-50 text-purple-600'
                }`}>
                  🎫 剩余 {assignment.times_left} 次{assignment.used_today ? ' (今日已用)' : ''}
                </span>
              )}
            </div>

            {assignment.book_description && (
              <p className="mt-2 line-clamp-1 text-xs text-ink-mute">{assignment.book_description}</p>
            )}

            <div className="mt-4">
              <div className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="text-ink-soft">
                  {assignment.scope_type === 'unit' || assignment.scope_type === 'group'
                    ? `${assignment.word_count} 个单词`
                    : `${assignment.unit_count} 个单元 · ${assignment.word_count} 个单词`}
                </span>
                <span className="font-numeric font-semibold text-ink">{assignment.progress_percentage}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${assignment.progress_percentage}%` }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className={`h-full rounded-full ${assignment.is_completed ? 'bg-emerald-500' : 'bg-accent-warm'}`}
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => openAssignment(assignment)}
                disabled={assignment.is_completed}
                className={`inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold transition ${
                  assignment.is_completed
                    ? 'cursor-not-allowed bg-black/[0.06] text-ink-mute'
                    : 'bg-accent-warm text-white hover:opacity-90'
                }`}
              >
                {assignment.is_completed ? '已完成' : assignment.progress_percentage > 0 ? '继续学习' : '开始学习'}
              </button>
            </div>
          </div>
        </div>
      </motion.article>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-accent-warm" />
          <p className="mt-4 text-ink-soft">正在加载教材任务...</p>
        </div>
      </div>
    );
  }

  const visiblePriority = showAllPriority ? groupedAssignments.priority : groupedAssignments.priority.slice(0, 3);
  const visibleOther = showAllOther ? groupedAssignments.other : groupedAssignments.other.slice(0, 6);

  return (
    <div className="min-h-screen bg-paper">
      <div className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex min-w-0 items-center">
            <button
              type="button"
              onClick={() => goBack()}
              className="mr-3 flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition hover:bg-orange-50 hover:text-orange-600"
              aria-label="返回"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600 sm:flex">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate font-display text-lg font-bold text-slate-800 sm:text-xl">教材任务</h1>
                <p className="hidden text-xs text-slate-500 sm:block">按重要程度完成老师指定的教材范围</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/student/homework')}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-orange-50 px-3 text-sm font-semibold text-orange-700 transition hover:bg-orange-100"
            aria-label="查看练习作业"
          >
            <ClipboardCheck className="h-4 w-4" />
            <span className="sm:hidden">作业</span>
            <span className="hidden sm:inline">练习作业</span>
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4 py-7 sm:py-9">
        {assignments.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-soft rounded-2xl border-dashed py-16 text-center"
          >
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
              <ClipboardList className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-bold text-slate-700">还没有教材任务</h2>
            <p className="mt-2 text-sm text-slate-500">老师指定教材或单元后会显示在这里</p>
          </motion.div>
        ) : (
          <div className="space-y-9">
            <header>
              <h2 className="font-display text-2xl font-semibold text-ink">先完成最重要的一项</h2>
              <p className="mt-2 text-sm text-ink-soft">
                {groupedAssignments.priority.length > 0
                  ? `有 ${groupedAssignments.priority.length} 项正在进行或临近截止。`
                  : '目前没有临近截止的任务，可以按顺序开始。'}
              </p>
            </header>

            {groupedAssignments.priority.length > 0 && (
              <section aria-labelledby="priority-assignment-title">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 id="priority-assignment-title" className="font-display text-lg font-semibold text-ink">优先完成</h3>
                    <p className="mt-1 text-xs text-ink-mute">先处理前 3 项，完成后再继续。</p>
                  </div>
                  {groupedAssignments.priority.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setShowAllPriority((visible) => !visible)}
                      aria-expanded={showAllPriority}
                      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-accent-warm transition hover:bg-orange-50"
                    >
                      {showAllPriority ? '收起' : `查看全部 ${groupedAssignments.priority.length} 项`}
                      <ChevronDown className={`h-4 w-4 transition-transform ${showAllPriority ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {visiblePriority.map(renderAssignment)}
                </div>
              </section>
            )}

            {groupedAssignments.other.length > 0 && (
              <section aria-labelledby="other-assignment-title">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 id="other-assignment-title" className="font-display text-lg font-semibold text-ink">
                      {groupedAssignments.priority.length > 0 ? '稍后完成' : '待开始'}
                    </h3>
                    <p className="mt-1 text-xs text-ink-mute">默认先显示 6 项，避免任务列表过长。</p>
                  </div>
                  {groupedAssignments.other.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setShowAllOther((visible) => !visible)}
                      aria-expanded={showAllOther}
                      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-accent-warm transition hover:bg-orange-50"
                    >
                      {showAllOther ? '收起' : `查看全部 ${groupedAssignments.other.length} 项`}
                      <ChevronDown className={`h-4 w-4 transition-transform ${showAllOther ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {visibleOther.map(renderAssignment)}
                </div>
              </section>
            )}

            {groupedAssignments.completed.length > 0 && (
              <section aria-labelledby="completed-assignment-title">
                <button
                  type="button"
                  onClick={() => setShowCompleted((visible) => !visible)}
                  aria-expanded={showCompleted}
                  className="flex min-h-11 w-full items-center justify-between border-t border-black/[0.06] pt-5 text-left"
                >
                  <span>
                    <span id="completed-assignment-title" className="font-display text-lg font-semibold text-ink">已完成</span>
                    <span className="ml-2 text-xs text-ink-mute">{groupedAssignments.completed.length} 项</span>
                  </span>
                  <ChevronDown className={`h-4 w-4 text-ink-soft transition-transform ${showCompleted ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {showCompleted && (
                  <div className="mt-3 space-y-3">
                    {groupedAssignments.completed.map(renderAssignment)}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
