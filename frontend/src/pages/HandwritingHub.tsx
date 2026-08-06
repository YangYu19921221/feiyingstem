/**
 * 纸笔听写入口页:选书 → 选单元 → 手写听写 / 打印默写纸
 *
 * 首页卡片直达这里。单元列表里也有同名分组,两个入口通向同一批页面。
 * 未分配的单元按严格模式锁定(与 UnitSelector 同口径:is_allowed === false)。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, ChevronRight, LockKeyhole, Printer } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { getStudentBooks, getBookProgress } from '../api/progress';
import type { StudentBook, BookProgress } from '../api/progress';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

export default function HandwritingHub() {
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');
  const [books, setBooks] = useState<StudentBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [openBookId, setOpenBookId] = useState<number | null>(null);
  const [bookProgress, setBookProgress] = useState<BookProgress | null>(null);
  const [unitsLoading, setUnitsLoading] = useState(false);

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
    try {
      setBookProgress(await getBookProgress(bookId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, '加载单元失败'));
      setOpenBookId(null);
    } finally {
      setUnitsLoading(false);
    }
  };

  const units = bookProgress
    ? [...bookProgress.units].sort((a, b) => (a.unit_number || 0) - (b.unit_number || 0))
    : [];

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
                      <div className="space-y-2">
                        {units.map((unit) => {
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
