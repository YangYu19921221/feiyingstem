import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Layers3,
  Play,
  RotateCcw,
} from 'lucide-react';
import api from '../api/client';
import useGoBack from '../hooks/useGoBack';

interface UnitProgress {
  unit_id: number;
  unit_number: number;
  unit_name: string;
  word_count: number;
  completed_words: number;
  progress_percentage: number;
  has_progress: boolean;
  current_word_index: number;
  last_studied_at: string | null;
  learning_mode: string | null;
  is_completed: boolean;
}

interface BookProgress {
  book_id: number;
  book_name: string;
  unit_count: number;
  word_count: number;
  completed_words: number;
  progress_percentage: number;
  units: UnitProgress[];
}

const modeNames: Record<string, string> = {
  flashcard: '分类学习',
  classify: '分类学习',
  spelling: '拼写练习',
  fillblank: '单词填空',
  quiz: '选择练习',
  dictation: '听写练习',
  sentencefill: '句子填空',
  exam: '单元测试',
};

const formatStudyTime = (value: string) => new Date(value).toLocaleDateString('zh-CN', {
  month: 'long',
  day: 'numeric',
});

export default function BookProgressDetail() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<BookProgress | null>(null);
  const [error, setError] = useState('');
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [showCompletedUnits, setShowCompletedUnits] = useState(false);

  const fetchProgress = async () => {
    try {
      setLoading(true);
      setError('');
      const token = localStorage.getItem('access_token');
      const data = await api.get(`/student/books/${bookId}/progress`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProgress(data);
    } catch (requestError) {
      console.error('获取进度失败:', requestError);
      setError('教材进度暂时没有加载出来，请重试一次。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProgress();
  }, [bookId]);

  const nextUnit = useMemo(() => {
    if (!progress) return null;
    return progress.units.find((unit) => !unit.is_completed)
      ?? progress.units.at(-1)
      ?? null;
  }, [progress]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper">
        <div className="border-b border-slate-200/80 bg-white/90">
          <div className="mx-auto max-w-5xl px-4 py-4">
            <div className="h-11 w-36 animate-pulse rounded-xl bg-slate-100" />
          </div>
        </div>
        <main className="mx-auto max-w-5xl space-y-5 px-4 py-8" aria-busy="true" aria-label="正在加载教材进度">
          <div className="h-32 animate-pulse rounded-2xl bg-white" />
          <div className="h-44 animate-pulse rounded-2xl bg-white" />
          <div className="space-y-3">
            {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-white" />)}
          </div>
        </main>
      </div>
    );
  }

  if (!progress || error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="card-soft w-full max-w-md rounded-2xl p-7 text-center sm:p-9">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
            <RotateCcw className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">进度暂时没打开</h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">{error || '没有找到这本教材的进度数据。'}</p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => goBack()}
              className="min-h-11 rounded-xl border border-black/10 px-5 text-sm font-semibold text-ink transition hover:bg-black/[0.04]"
            >
              返回书架
            </button>
            <button
              type="button"
              onClick={() => void fetchProgress()}
              className="min-h-11 rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }

  const remainingWords = Math.max(progress.word_count - progress.completed_words, 0);
  const completedUnits = progress.units.filter((unit) => unit.is_completed).length;
  const upcomingUnits = progress.units.filter((unit) => !unit.is_completed);
  const completedUnitItems = progress.units.filter((unit) => unit.is_completed);
  const visibleUpcomingUnits = showAllUpcoming ? upcomingUnits : upcomingUnits.slice(0, 4);

  const renderUnit = (unit: UnitProgress, index: number) => (
    <motion.article
      key={unit.unit_id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: Math.min(index * 0.035, 0.2), ease: [0.16, 1, 0.3, 1] }}
      className="p-4 sm:p-5"
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-numeric text-sm font-semibold ${
          unit.is_completed ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-accent-warm'
        }`}>
          {unit.is_completed ? <CheckCircle2 className="h-5 w-5" aria-label="已完成" /> : unit.unit_number}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="font-display font-semibold text-ink">
                Unit {unit.unit_number} · {unit.unit_name}
              </h3>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-mute">
                <span>{unit.completed_words}/{unit.word_count} 个单词</span>
                {unit.last_studied_at && (
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatStudyTime(unit.last_studied_at)}学习过
                  </span>
                )}
                {unit.learning_mode && <span>上次：{modeNames[unit.learning_mode] || '学习练习'}</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/student/units/${unit.unit_id}/classify`)}
              className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-5 text-sm font-semibold transition ${
                unit.is_completed
                  ? 'border border-black/10 text-ink hover:bg-black/[0.04]'
                  : 'bg-accent-warm text-white hover:opacity-90'
              }`}
            >
              {unit.is_completed ? '再次复习' : unit.has_progress ? '继续学习' : '开始学习'}
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${unit.progress_percentage}%` }}
                transition={{ duration: 0.45, delay: Math.min(0.08 + index * 0.025, 0.25), ease: [0.16, 1, 0.3, 1] }}
                className={`h-full rounded-full ${unit.is_completed ? 'bg-emerald-500' : 'bg-accent-warm'}`}
              />
            </div>
            <span className="w-10 text-right font-numeric text-xs font-semibold text-ink-soft">
              {unit.progress_percentage.toFixed(0)}%
            </span>
          </div>
        </div>
      </div>
    </motion.article>
  );

  return (
    <div className="min-h-screen bg-paper">
      <nav className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur" aria-label="教材进度导航">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3.5">
          <button
            type="button"
            onClick={() => goBack()}
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-soft transition hover:bg-orange-50 hover:text-accent-warm"
            aria-label="返回"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-semibold text-ink sm:text-xl">{progress.book_name}</h1>
            <p className="hidden text-xs text-ink-mute sm:block">教材进度</p>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-4 py-7 sm:py-9">
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="student-colorful-surface mb-6 overflow-hidden rounded-2xl border border-orange-100 p-5 sm:p-7"
        >
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <p className="text-sm font-medium text-ink-soft">
                {progress.progress_percentage >= 100 ? '整本教材已经完成' : '继续保持，今天再前进一步'}
              </p>
              <h2 className="mt-2 font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">
                已完成 <span className="font-numeric text-accent-warm">{progress.progress_percentage.toFixed(0)}%</span>
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-ink-soft">
                {remainingWords > 0
                  ? `还剩 ${remainingWords} 个单词。先完成下一小段，不用一次学完。`
                  : '所有单词都已完成，可以回到单元里复习和巩固。'}
              </p>
            </div>
            {nextUnit && (
              <button
                type="button"
                onClick={() => navigate(`/student/units/${nextUnit.unit_id}/classify`)}
                className="btn-glow inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold text-white"
              >
                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                {nextUnit.is_completed ? '复习最后单元' : nextUnit.has_progress ? '继续下一单元' : '开始下一单元'}
              </button>
            )}
          </div>
          <div className="mt-6 h-2 overflow-hidden rounded-full bg-black/[0.06]">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress.progress_percentage}%` }}
              transition={{ duration: 0.65, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="h-full rounded-full bg-accent-warm"
            />
          </div>
        </motion.section>

        <section className="mb-9 grid grid-cols-3 divide-x divide-black/[0.06] rounded-2xl bg-white py-5" aria-label="教材进度概览">
          {[
            { label: '已学单词', value: progress.completed_words, icon: CheckCircle2 },
            { label: '全部单词', value: progress.word_count, icon: BookOpenText },
            { label: '完成单元', value: `${completedUnits}/${progress.unit_count}`, icon: Layers3 },
          ].map((item) => (
            <div key={item.label} className="px-2 text-center sm:px-5">
              <item.icon className="mx-auto mb-2 h-4 w-4 text-accent-warm" aria-hidden="true" />
              <p className="font-numeric text-xl font-semibold text-ink sm:text-2xl">{item.value}</p>
              <p className="mt-1 text-[11px] text-ink-mute sm:text-xs">{item.label}</p>
            </div>
          ))}
        </section>

        <section aria-labelledby="unit-progress-title">
          <header className="mb-4">
            <h2 id="unit-progress-title" className="font-display text-xl font-semibold text-ink">单元进度</h2>
            <p className="mt-1 text-sm text-ink-soft">优先显示接下来要学的单元，已完成内容可随时展开复习。</p>
          </header>

          {progress.units.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-5 py-12 text-center">
              <BookOpenText className="mx-auto h-8 w-8 text-ink-mute" aria-hidden="true" />
              <h3 className="mt-4 font-semibold text-ink">这本教材还没有单元</h3>
              <p className="mt-1 text-sm text-ink-mute">老师添加单元后会显示在这里。</p>
            </div>
          ) : (
            <div className="space-y-4">
              {upcomingUnits.length > 0 && (
                <section aria-labelledby="upcoming-unit-title">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 id="upcoming-unit-title" className="text-sm font-semibold text-ink-soft">接下来学习</h3>
                    <span className="text-xs text-ink-mute">{upcomingUnits.length} 个单元</span>
                  </div>
                  <div className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl bg-white">
                    {visibleUpcomingUnits.map(renderUnit)}
                  </div>
                  {upcomingUnits.length > 4 && (
                    <button
                      type="button"
                      onClick={() => setShowAllUpcoming((visible) => !visible)}
                      aria-expanded={showAllUpcoming}
                      className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-accent-warm transition hover:bg-orange-50"
                    >
                      {showAllUpcoming ? '收起后续单元' : `查看其余 ${upcomingUnits.length - 4} 个单元`}
                      <ChevronDown className={`h-4 w-4 transition-transform ${showAllUpcoming ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                  )}
                </section>
              )}

              {completedUnitItems.length > 0 && (
                <section aria-labelledby="completed-unit-title">
                  <button
                    type="button"
                    onClick={() => setShowCompletedUnits((visible) => !visible)}
                    aria-expanded={showCompletedUnits}
                    className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 text-left transition hover:bg-emerald-50"
                  >
                    <span>
                      <span id="completed-unit-title" className="block text-sm font-semibold text-emerald-800">已完成 {completedUnitItems.length} 个单元</span>
                      <span className="mt-0.5 block text-xs text-emerald-700/80">需要复习时再展开</span>
                    </span>
                    <ChevronDown className={`h-5 w-5 text-emerald-700 transition-transform ${showCompletedUnits ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  {showCompletedUnits && (
                    <div className="mt-3 divide-y divide-black/[0.06] overflow-hidden rounded-2xl bg-white">
                      {completedUnitItems.map((unit, index) => renderUnit(unit, visibleUpcomingUnits.length + index))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
