/**
 * 语法小课「句子积木」的课表(2026-11-15,样课)。规则真源 backend/app/services/grammar_course.py 文件头。
 *
 * 对孩子不叫语法,叫「句子积木」。一条线上的小课按顺序排着,点哪节上哪节(样课阶段不锁顺序)。
 * 样课阶段默认只有老师 / 机构管理员 / 平台管理员能点开(preview),学生那边还没有入口。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, LoaderCircle } from 'lucide-react';
import { grammarApi, type LessonsView } from '../api/grammar';
import { getErrorMessage } from '../utils/errorMessage';

export default function GrammarHome() {
  const navigate = useNavigate();
  const [data, setData] = useState<LessonsView | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    grammarApi.lessons()
      .then((d) => { if (alive) { setData(d); setError(''); } })
      .catch((e) => { if (alive) setError(getErrorMessage(e, '课表没打开,稍后再试')); });
    return () => { alive = false; };
  }, [attempt]);
  const load = useCallback(() => { setError(''); setAttempt((n) => n + 1); }, []);

  return (
    <div className="min-h-screen bg-[#fff8f0]">
      <nav className="sticky top-0 z-10 border-b border-orange-100 bg-[#fff8f0]/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => navigate('/dashboard')} aria-label="回首页"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-orange-50 hover:text-orange-600">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <img src="/tutor-avatar.jpg" alt="" className="h-9 w-9 rounded-full object-cover" />
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-ink">句子积木</h1>
            <p className="text-xs text-ink-mute">跟小鹰老师用积木拼句子,一节大约 3 分钟</p>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-2xl px-4 py-5">
        {error ? (
          <div className="rounded-2xl border border-orange-100 bg-white p-6 text-center">
            <p className="text-sm text-rose-600">{error}</p>
            <button type="button" onClick={load} className="mt-3 min-h-11 px-4 text-sm font-semibold text-accent-warm">
              再试一次
            </button>
          </div>
        ) : !data ? (
          <div className="flex justify-center py-20" role="status">
            <LoaderCircle className="h-6 w-6 animate-spin text-orange-500" aria-label="加载中" />
          </div>
        ) : !data.enabled ? (
          <div className="rounded-2xl border border-orange-100 bg-white p-6 text-center">
            <p className="text-base text-ink">{data.reason}</p>
            <button type="button" onClick={() => navigate('/dashboard')} className="mt-3 min-h-11 px-4 text-sm font-semibold text-accent-warm">
              回首页
            </button>
          </div>
        ) : (
          <>
            {data.preview && (
              <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                这是试课: 现在只有老师和管理员能看到这里,学生那边还没有入口。点一节进去,和孩子将来看到的一样。
              </p>
            )}
            {data.lines.map((line) => (
              <section key={line.id} className="mb-6">
                <h2 className="text-xl font-bold text-ink">{line.name}</h2>
                <p className="mt-0.5 text-sm text-ink-mute" lang="en">{line.sub}</p>
                <ol className="mt-3 space-y-2.5">
                  {line.lessons.map((ls, n) => (
                    <li key={ls.id}>
                      <button type="button" onClick={() => navigate(`/student/grammar/${ls.id}`)}
                        className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border-2 border-orange-100 bg-white px-3 py-3 text-left transition hover:border-orange-300 hover:bg-orange-50 active:scale-[0.99]">
                        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold ${
                          ls.done ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                          {ls.done ? <Check className="h-5 w-5" aria-label="学过了" /> : n + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-base font-bold text-ink">{ls.name}</span>
                          <span className="block truncate text-sm font-semibold text-sky-800" lang="en">{ls.title}</span>
                          <span className="block text-xs text-ink-mute">
                            {ls.done && ls.best !== null
                              ? `学过 ${ls.times} 次 · 自己练最好一次做对 ${ls.best}/${ls.practice_count}`
                              : ls.goal}
                          </span>
                        </span>
                        <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
