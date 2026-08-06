/**
 * 纸笔听写入口页:选书 → 选单元 → 手写听写 / 打印默写纸
 *
 * 布局:书本 = 封面色卡片网格(桌面 3 列/平板 2 列/手机 1 列),
 * 点选后单元同样以网格铺开——桌面不再是撑不满的手机窄条。
 * 未分配的单元按严格模式锁定(与 UnitSelector 同口径:is_allowed === false)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpenText, Camera, LockKeyhole, Printer, Search, X } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { getStudentBooks, getBookProgress } from '../api/progress';
import type { StudentBook, BookProgress } from '../api/progress';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

// 折叠阈值都取网格列数(lg 3 列)的整倍数,折叠态收在两行/四行整
// 书 >6 折叠+搜索:生产实测有学生被分配 40 本
// 单元 >12 折叠+搜索:生产有 98 单元的书
const BOOK_COLLAPSE_LIMIT = 6;
const UNIT_COLLAPSE_LIMIT = 12;

/** 搜索框(书/单元两处共用同一形态) */
function SearchBox({ value, onChange, placeholder, label }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
      <input
        type="text"
        inputMode="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="w-full min-h-11 rounded-xl border border-black/[0.08] bg-white pl-9 pr-10 text-base text-ink placeholder:text-ink-mute focus:border-accent-warm focus:outline-none focus:ring-2 focus:ring-accent-warm/20"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="清除搜索"
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-mute transition hover:bg-black/5 hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

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
  const [bookSearch, setBookSearch] = useState('');
  const [showAllBooks, setShowAllBooks] = useState(false);
  const unitsSectionRef = useRef<HTMLElement>(null);

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
      // 桌面上书网格可能有两三行,选中后把单元区带进视野
      requestAnimationFrame(() => {
        unitsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, '加载单元失败'));
      setOpenBookId(null);
    } finally {
      setUnitsLoading(false);
    }
  };

  // ⚠️ /student/books 返回的是全部单词本(owned 只是标记,生产 50 本全回来),
  // 这里只显示分配给我的——没分配的书点进去单元全是锁,列出来纯噪音。
  // 口径与学生首页书架一致(StudentDashboard 同样 filter(owned))。
  const ownedBooks = useMemo(() => books.filter((b) => b.owned), [books]);

  const bookTerm = bookSearch.trim().toLowerCase();
  const matchedBooks = useMemo(
    () => (bookTerm ? ownedBooks.filter((b) => b.name.toLowerCase().includes(bookTerm)) : ownedBooks),
    [ownedBooks, bookTerm],
  );
  const booksCollapsed = !bookTerm && !showAllBooks && matchedBooks.length > BOOK_COLLAPSE_LIMIT;
  const visibleBooks = booksCollapsed ? matchedBooks.slice(0, BOOK_COLLAPSE_LIMIT) : matchedBooks;

  const openBook = openBookId != null ? ownedBooks.find((b) => b.id === openBookId) ?? null : null;

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
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
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

      <div className="mx-auto max-w-5xl px-5 py-8">
        <section className="student-colorful-surface mb-8 overflow-hidden rounded-2xl border border-slate-200/80 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-5">
            <div>
              <p className="mb-1 text-xs font-semibold text-orange-700">纸笔听写</p>
              <h2 className="font-display text-2xl font-bold text-slate-800">在纸上手写，拍照自动批改</h2>
              <p className="mt-2 max-w-xl text-sm text-slate-600">
                考试考的是手写拼写。App 报词，你写在纸上，拍一张照 AI 逐词批改，错词自动进薄弱词。
              </p>
            </div>
            <img src="/hero-memory.jpeg" alt="" className="hidden h-24 w-32 rounded-xl object-cover shadow-sm sm:block" />
          </div>
        </section>

        <section aria-label="选择单词本">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-ink-mute text-sm mb-1">先选一本单词本</p>
              <h2 className="font-display text-2xl md:text-3xl font-semibold text-ink tracking-tight">
                我的单词本
              </h2>
            </div>
            {ownedBooks.length > BOOK_COLLAPSE_LIMIT && (
              <div className="w-full sm:w-72">
                <SearchBox
                  value={bookSearch}
                  onChange={setBookSearch}
                  placeholder={`搜索单词本(共 ${ownedBooks.length} 本)`}
                  label="搜索单词本"
                />
              </div>
            )}
          </div>

          {loading ? (
            <div className="py-16 text-center text-sm text-ink-mute">加载中…</div>
          ) : ownedBooks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-black/10 py-16 text-center">
              <p className="text-ink-soft mb-1">还没有分配单词本</p>
              <p className="text-xs text-ink-mute">等老师分配后就能看到</p>
            </div>
          ) : matchedBooks.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-black/10 py-10 text-center text-sm text-ink-mute">
              没有找到「{bookSearch.trim()}」,换个词试试
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleBooks.map((book) => {
                  const selected = openBookId === book.id;
                  return (
                    <button
                      key={book.id}
                      type="button"
                      onClick={() => handleOpenBook(book.id)}
                      aria-pressed={selected}
                      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-white text-left transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 ${
                        selected
                          ? 'border-accent-warm ring-2 ring-accent-warm/30'
                          : 'border-black/[0.06] hover:border-black/[0.14]'
                      }`}
                    >
                      {/* 封面色带:让 40 本书不是一片白,孩子按颜色认书。
                          外层必须 flex-col:button 默认把内容垂直居中,同行卡片被
                          grid 拉成等高后,矮内容会浮到中间、色带脱离顶部(实测参差) */}
                      <div className="h-1.5 w-full shrink-0" style={{ background: book.cover_color || '#FF6B35' }} />
                      <div className="flex items-start gap-3 p-4">
                        <span
                          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
                          style={{ background: book.cover_color || '#FF6B35' }}
                        >
                          <BookOpenText className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{book.name}</span>
                          <span className="mt-0.5 block text-xs text-ink-mute">
                            {book.unit_count} 单元 · {book.word_count} 词
                          </span>
                          {book.progress_percentage > 0 && (
                            <span className="mt-2 block">
                              <span className="block h-1 overflow-hidden rounded-full bg-black/[0.06]">
                                <span
                                  className="block h-full rounded-full bg-accent-warm"
                                  style={{ width: `${Math.min(100, book.progress_percentage)}%` }}
                                />
                              </span>
                              <span className="mt-1 block font-numeric text-[10px] text-ink-mute">
                                已学 {book.progress_percentage.toFixed(0)}%
                              </span>
                            </span>
                          )}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {booksCollapsed && (
                <button
                  type="button"
                  onClick={() => setShowAllBooks(true)}
                  className="mt-3 min-h-11 w-full rounded-xl border border-dashed border-black/[0.12] text-sm font-medium text-ink-soft transition hover:border-black/25 hover:bg-black/[0.02]"
                >
                  显示全部 {matchedBooks.length} 本(还有 {matchedBooks.length - BOOK_COLLAPSE_LIMIT} 本)
                </button>
              )}
            </>
          )}
        </section>

        {/* 单元区:选中书后出现 */}
        {openBookId != null && (
          <section ref={unitsSectionRef} aria-label="选择单元" className="mt-10 scroll-mt-20">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-ink-mute text-sm mb-1 truncate">{openBook?.name ?? '单词本'}</p>
                <h2 className="font-display text-2xl md:text-3xl font-semibold text-ink tracking-tight">
                  选一个单元开始
                </h2>
              </div>
              {units.length > UNIT_COLLAPSE_LIMIT && (
                <div className="w-full sm:w-72">
                  <SearchBox
                    value={unitSearch}
                    onChange={setUnitSearch}
                    placeholder={`搜索单元(共 ${units.length} 个)`}
                    label="搜索单元"
                  />
                </div>
              )}
            </div>

            {unitsLoading ? (
              <p className="py-10 text-center text-sm text-ink-mute">加载单元…</p>
            ) : units.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-black/10 py-10 text-center text-sm text-ink-mute">
                该单词本还没有单元
              </p>
            ) : matchedUnits.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-black/10 py-10 text-center text-sm text-ink-mute">
                没有找到「{unitSearch.trim()}」,换个词试试
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleUnits.map((unit) => {
                    const locked = unit.is_allowed === false;
                    return (
                      <div
                        key={unit.unit_id}
                        className={`rounded-2xl border border-black/[0.06] bg-white p-4 ${locked ? 'opacity-55' : ''}`}
                      >
                        <div className="mb-3 flex items-baseline justify-between gap-2">
                          <span className="truncate font-medium text-ink">{unit.unit_name}</span>
                          <span className="shrink-0 font-numeric text-xs text-ink-mute">{unit.word_count} 词</span>
                        </div>
                        {locked ? (
                          <p className="flex min-h-11 items-center gap-1.5 text-xs text-ink-mute">
                            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                            待老师分配
                          </p>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => navigate(`/student/units/${unit.unit_id}/handwriting`)}
                              className="flex min-h-11 flex-[2] items-center justify-center gap-1.5 rounded-lg bg-accent-warm text-sm font-semibold text-white transition hover:opacity-90 active:scale-95"
                            >
                              <Camera className="h-4 w-4" aria-hidden="true" />
                              手写听写
                            </button>
                            <button
                              type="button"
                              onClick={() => navigate(`/student/units/${unit.unit_id}/handwriting-sheet`)}
                              className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-black/[0.08] text-sm font-medium text-ink transition hover:bg-black/[0.02] active:scale-95"
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
          </section>
        )}
      </div>
    </div>
  );
}
