/**
 * 纸笔听写入口页:选书 → 选单元 → 手写听写 / 打印默写纸
 *
 * 首页卡片直达这里。单元列表里也有同名分组,两个入口通向同一批页面。
 * 未分配的单元按严格模式锁定(与 UnitSelector 同口径:is_allowed === false)。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, ChevronRight, LockKeyhole, Printer, Search, X } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { getStudentBooks, getBookProgress } from '../api/progress';
import type { StudentBook, BookProgress } from '../api/progress';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

// 单元超过这个数就先折叠(生产有 98 单元的书,一次全铺开要滚很久);
// 书列表不折叠——每个学生最多分配 4 本书,搜索反而碍事
const UNIT_COLLAPSE_LIMIT = 12;

export default function HandwritingHub() {
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');
  const [books, setBooks] = useState<StudentBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [openBookId, setOpenBookId] = useState<number | null>(null);
  const [bookProgress, setBookProgress] = useState<BookProgress | null>(null);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitSearch, setUnitSearch] = useState('');
  const [showAllUnits, setShowAllUnits] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setBooks(await getStudentBooks());
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, '加载单词本失败'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleOpenBook = async (bookId: number) => {
    if (openBookId === bookId) {
      setOpenBookId(null);
      return;
    }
    setOpenBookId(bookId);
    setUnitsLoading(true);
    setBookProgress(null);
    // 换书时清掉上一本的搜索词和展开态,否则搜索残留会让新书"看起来没单元"
    setUnitSearch('');
    setShowAllUnits(false);
    try {
      setBookProgress(await getBookProgress(bookId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, '加载单元失败'));
      setOpenBookId(null);
    } finally {
      setUnitsLoading(false);
    }
  };

  const units = useMemo(
    () => (bookProgress
      ? [...bookProgress.units].sort((a, b) => (a.unit_number || 0) - (b.unit_number || 0))
      : []),
    [bookProgress],
  );

  // 搜索按单元名匹配;有搜索词时不折叠(搜出来的就该全给看)
  const term = unitSearch.trim().toLowerCase();
  const matchedUnits = useMemo(
    () => (term ? units.filter((u) => u.unit_name.toLowerCase().includes(term)) : units),
    [units, term],
  );
  const collapsed = !term && !showAllUnits && matchedUnits.length > UNIT_COLLAPSE_LIMIT;
  const visibleUnits = collapsed ? matchedUnits.slice(0, UNIT_COLLAPSE_LIMIT) : matchedUnits;

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => goBack()}
            className="flex min-h-11 items-center gap-2 text-ink-soft hover:text-ink text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> 返回
          </button>
          <h1 className="font-display text-base font-semibold text-ink">纸笔听写</h1>
          <div className="w-12" />
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-5 py-8">
        <section className="student-colorful-surface mb-6 overflow-hidden rounded-2xl border border-slate-200/80 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-5">
            <div>
              <p className="mb-1 text-xs font-semibold text-orange-700">纸笔听写</p>
              <h2 className="font-display text-2xl font-bold text-slate-800">在纸上手写，拍照自动批改</h2>
              <p className="mt-2 text-sm text-slate-600">
                考试考的是手写拼写。App 报词，你写在纸上，拍一张照 AI 逐词批改，错词自动进薄弱词。
              </p>
            </div>
            <img src="/hero-memory.jpeg" alt="" className="hidden h-24 w-32 rounded-xl object-cover shadow-sm sm:block" />
          </div>
        </section>

        <section className="mb-6">
          <p className="text-ink-mute text-sm mb-1.5">准备好纸和笔 · 也可以先打印默写纸</p>
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink tracking-tight">
            选一个单元开始
          </h2>
        </section>

        {loading ? (
          <div className="py-16 text-center text-sm text-ink-mute">加载中…</div>
        ) : books.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-black/10 rounded-2xl">
            <p className="text-ink-soft mb-1">还没有分配单词本</p>
            <p className="text-xs text-ink-mute">等老师分配后就能看到</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-black/[0.05] overflow-hidden divide-y divide-black/[0.05]">
            {books.map((book) => (
              <div key={book.id}>
                <button
                  type="button"
                  onClick={() => handleOpenBook(book.id)}
                  aria-expanded={openBookId === book.id}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-black/[0.025]"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-ink truncate">{book.name}</h3>
                    <p className="text-xs text-ink-mute mt-0.5">
                      {book.unit_count} 单元 · {book.word_count} 词
                    </p>
                  </div>
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 text-ink-mute transition-transform ${openBookId === book.id ? 'rotate-90' : ''}`}
                    aria-hidden="true"
                  />
                </button>

                {openBookId === book.id && (
                  <div className="bg-black/[0.015] px-5 py-4">
                    {unitsLoading ? (
                      <p className="py-6 text-center text-sm text-ink-mute">加载单元…</p>
                    ) : units.length === 0 ? (
                      <p className="py-6 text-center text-sm text-ink-mute">该单词本还没有单元</p>
                    ) : (
                      <>
                        {/* 单元多才给搜索框,几个单元还要搜索反而添乱 */}
                        {units.length > UNIT_COLLAPSE_LIMIT && (
                          <div className="relative mb-3">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
                            <input
                              type="text"
                              inputMode="search"
                              value={unitSearch}
                              onChange={(e) => setUnitSearch(e.target.value)}
                              placeholder={`搜索单元(共 ${units.length} 个)`}
                              aria-label="搜索单元"
                              className="w-full min-h-11 rounded-xl border border-black/[0.08] bg-white pl-9 pr-10 text-base text-ink placeholder:text-ink-mute focus:border-accent-warm focus:outline-none focus:ring-2 focus:ring-accent-warm/20"
                            />
                            {unitSearch && (
                              <button
                                type="button"
                                onClick={() => setUnitSearch('')}
                                aria-label="清除搜索"
                                className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-mute transition hover:bg-black/5 hover:text-ink"
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        )}

                        {matchedUnits.length === 0 ? (
                          <p className="py-6 text-center text-sm text-ink-mute">
                            没有找到「{unitSearch.trim()}」,换个词试试
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {visibleUnits.map((unit) => {
                          const locked = unit.is_allowed === false;
                          return (
                            <div
                              key={unit.unit_id}
                              className={`rounded-xl bg-white px-4 py-3 ring-1 ring-black/[0.05] ${locked ? 'opacity-55' : ''}`}
                            >
                              <div className="flex items-center gap-2 mb-2.5">
                                <span className="font-medium text-ink text-sm truncate flex-1">
                                  {unit.unit_name}
                                </span>
                                <span className="text-xs text-ink-mute shrink-0">{unit.word_count} 词</span>
                              </div>
                              {locked ? (
                                <p className="flex items-center gap-1.5 text-xs text-ink-mute">
                                  <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                                  待老师分配
                                </p>
                              ) : (
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => navigate(`/student/units/${unit.unit_id}/handwriting`)}
                                    className="flex-[2] min-h-11 rounded-lg bg-accent-warm text-white text-sm font-semibold transition hover:opacity-90 active:scale-95 flex items-center justify-center gap-1.5"
                                  >
                                    <Camera className="h-4 w-4" aria-hidden="true" />
                                    手写听写
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => navigate(`/student/units/${unit.unit_id}/handwriting-sheet`)}
                                    className="flex-1 min-h-11 rounded-lg border border-black/[0.08] text-ink text-sm font-medium transition hover:bg-black/[0.02] active:scale-95 flex items-center justify-center gap-1.5"
                                  >
                                    <Printer className="h-4 w-4" aria-hidden="true" />
                                    打印
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                          </div>
                        )}

                        {collapsed && (
                          <button
                            type="button"
                            onClick={() => setShowAllUnits(true)}
                            className="mt-3 min-h-11 w-full rounded-xl border border-dashed border-black/[0.12] text-sm font-medium text-ink-soft transition hover:border-black/25 hover:bg-black/[0.02]"
                          >
                            显示全部 {matchedUnits.length} 个单元(还有 {matchedUnits.length - UNIT_COLLAPSE_LIMIT} 个)
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
